import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";

export type ImagePolicyErrorCode =
  | "SSRF_BLOCKED"
  | "TOO_LARGE"
  | "INVALID_MIME"
  | "TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "NETWORK_ERROR";

export class ImagePolicyError extends Error {
  readonly code: ImagePolicyErrorCode;
  constructor(message: string, code: ImagePolicyErrorCode) {
    super(message);
    this.name = "ImagePolicyError";
    this.code = code;
  }
}

export interface DnsLookupResult {
  address: string;
}

export type DnsLookupImpl = (hostname: string) => Promise<DnsLookupResult>;
export type HttpsRequestImpl = typeof https.request;

export interface SecureDownloadOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedMimeTypes?: string[];
  /** Injectable pour les tests (simuler une résolution DNS malveillante) — par défaut `dns/promises`.lookup. */
  dnsLookupImpl?: DnsLookupImpl;
  /** Injectable pour les tests — par défaut `https.request`. */
  requestImpl?: HttpsRequestImpl;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_REDIRECTS = 2;
const DEFAULT_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

const MAGIC_BYTES: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

function detectMimeFromBytes(buffer: Buffer): string | null {
  for (const { mime, bytes } of MAGIC_BYTES) {
    if (buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b)) return mime;
  }
  return null;
}

/** Rejette loopback, plages privées RFC1918, link-local (dont le endpoint metadata cloud 169.254.169.254) et équivalents IPv6. */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower === "::" || lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

async function resolveAndCheckIp(hostname: string, lookupImpl: DnsLookupImpl): Promise<string> {
  const { address } = await lookupImpl(hostname);
  if (isPrivateOrReservedIp(address)) {
    throw new ImagePolicyError(`Adresse IP interdite pour ${hostname} (${address}).`, "SSRF_BLOCKED");
  }
  return address;
}

type SingleRequestOutcome = { type: "redirect"; location: string } | { type: "body"; bytes: Buffer };

function requestOnce(
  requestImpl: HttpsRequestImpl,
  parsed: URL,
  pinnedIp: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<SingleRequestOutcome> {
  return new Promise((resolve, reject) => {
    const req = requestImpl(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        timeout: timeoutMs,
        // Épingle la connexion sur l'IP déjà validée — empêche un
        // rebinding DNS entre la vérification et la connexion réelle.
        lookup: (_hostname: string, _options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
          callback(null, pinnedIp, pinnedIp.includes(":") ? 6 : 4);
        },
      } as https.RequestOptions,
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ type: "redirect", location: res.headers.location });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new ImagePolicyError(`Réponse HTTP ${status}.`, "NETWORK_ERROR"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy();
            reject(new ImagePolicyError("Fichier trop volumineux.", "TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ type: "body", bytes: Buffer.concat(chunks) }));
        res.on("error", (err: Error) => reject(new ImagePolicyError(err.message, "NETWORK_ERROR")));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new ImagePolicyError("Délai dépassé lors du téléchargement de l'image.", "TIMEOUT"));
    });
    req.on("error", (err: Error) => reject(new ImagePolicyError(err.message, "NETWORK_ERROR")));
    req.end();
  });
}

/**
 * Téléchargement d'image avec garde-fous anti-SSRF complets — utilisé
 * uniquement en repli, quand un provider exige les octets plutôt qu'une URL.
 * Jamais l'URL ni le contenu binaire dans un log (voir `image-policy` ADR).
 */
export async function downloadImageSecurely(
  url: string,
  options: SecureDownloadOptions = {},
): Promise<{ bytes: Buffer; mime: string }> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME;
  const lookupImpl = options.dnsLookupImpl ?? (async (hostname: string) => dnsLookup(hostname));
  const requestImpl = options.requestImpl ?? https.request;

  let currentUrl = url;
  for (let redirect = 0; ; redirect += 1) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "https:") {
      throw new ImagePolicyError("Seul HTTPS est autorisé.", "SSRF_BLOCKED");
    }
    const pinnedIp = await resolveAndCheckIp(parsed.hostname, lookupImpl);
    const outcome = await requestOnce(requestImpl, parsed, pinnedIp, timeoutMs, maxBytes);

    if (outcome.type === "redirect") {
      if (redirect >= maxRedirects) {
        throw new ImagePolicyError("Trop de redirections.", "TOO_MANY_REDIRECTS");
      }
      currentUrl = new URL(outcome.location, parsed).toString();
      continue;
    }

    const mime = detectMimeFromBytes(outcome.bytes);
    if (!mime || !allowedMimeTypes.includes(mime)) {
      throw new ImagePolicyError("Type de fichier non reconnu comme image autorisée.", "INVALID_MIME");
    }
    return { bytes: outcome.bytes, mime };
  }
}
