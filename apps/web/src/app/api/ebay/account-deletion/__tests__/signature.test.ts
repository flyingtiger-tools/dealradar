import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { verifyEbaySignature, clearPublicKeyCacheForTests } from "../signature";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

const CONFIG = { clientId: "id", clientSecret: "secret", environment: "sandbox" as const };

function sign(body: string): string {
  const signer = createSign("SHA1");
  signer.update(body, "utf8");
  signer.end();
  return signer.sign(privateKey).toString("base64");
}

function signatureHeader(body: string, kid = "key-1"): string {
  return Buffer.from(JSON.stringify({ kid, signature: sign(body) })).toString("base64");
}

function fetchReturningKey(keyPem: string) {
  return async () =>
    new Response(JSON.stringify({ key: keyPem }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fetchSequence(...responses: Array<() => Promise<Response>>) {
  let call = 0;
  return async () => {
    // La première requête est toujours la demande de token OAuth ; la
    // seconde la récupération de la clé publique — même séquence que le
    // client OAuth réel (packages/connectors/src/ebay/oauth.ts).
    if (call === 0) {
      call += 1;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return responses[call++ - 1]?.() ?? new Response("unexpected call", { status: 500 });
  };
}

beforeEach(() => {
  clearPublicKeyCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyEbaySignature", () => {
  it("valide une signature correcte contre les octets bruts exacts du corps", async () => {
    const body = JSON.stringify({ hello: "world" });
    const header = signatureHeader(body);
    const fetchImpl = fetchSequence(fetchReturningKey(PUBLIC_KEY_PEM)) as unknown as typeof fetch;

    const outcome = await verifyEbaySignature(body, header, { ...CONFIG, fetchImpl });
    expect(outcome.valid).toBe(true);
  });

  it("rejette une signature valide mais pour un corps différent (détection d'altération)", async () => {
    const originalBody = JSON.stringify({ hello: "world" });
    const tamperedBody = JSON.stringify({ hello: "tampered" });
    const header = signatureHeader(originalBody);
    const fetchImpl = fetchSequence(fetchReturningKey(PUBLIC_KEY_PEM)) as unknown as typeof fetch;

    const outcome = await verifyEbaySignature(tamperedBody, header, { ...CONFIG, fetchImpl });
    expect(outcome).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejette quand l'en-tête X-EBAY-SIGNATURE est absent", async () => {
    const outcome = await verifyEbaySignature("{}", null, CONFIG);
    expect(outcome).toEqual({ valid: false, reason: "missing_header" });
  });

  it("rejette un en-tête qui n'est pas du JSON valide en base64", async () => {
    const outcome = await verifyEbaySignature("{}", Buffer.from("not json").toString("base64"), CONFIG);
    expect(outcome).toEqual({ valid: false, reason: "malformed_header" });
  });

  it("rejette un en-tête décodé sans kid/signature", async () => {
    const header = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64");
    const outcome = await verifyEbaySignature("{}", header, CONFIG);
    expect(outcome).toEqual({ valid: false, reason: "malformed_header" });
  });

  it("rejette proprement quand la récupération de la clé publique échoue", async () => {
    const body = "{}";
    const header = signatureHeader(body);
    const fetchImpl = fetchSequence(async () => new Response("down", { status: 500 })) as unknown as typeof fetch;

    const outcome = await verifyEbaySignature(body, header, { ...CONFIG, fetchImpl });
    expect(outcome).toEqual({ valid: false, reason: "public_key_fetch_failed" });
  });

  it("met en cache la clé publique : un second appel ne refait pas la requête réseau", async () => {
    const body = "{}";
    const header = signatureHeader(body);

    await verifyEbaySignature(body, header, {
      ...CONFIG,
      fetchImpl: fetchSequence(fetchReturningKey(PUBLIC_KEY_PEM)) as unknown as typeof fetch,
    });
    const secondFetch = fetchSequence(async () => {
      throw new Error("ne devrait jamais être appelé — la clé doit venir du cache");
    });
    const outcome = await verifyEbaySignature(body, header, { ...CONFIG, fetchImpl: secondFetch as unknown as typeof fetch });
    expect(outcome.valid).toBe(true);
  });

  it("re-récupère la clé publique après environ une heure (expiration du cache)", async () => {
    vi.useFakeTimers();
    try {
      const body = "{}";
      const header = signatureHeader(body);

      await verifyEbaySignature(body, header, {
        ...CONFIG,
        fetchImpl: fetchSequence(fetchReturningKey(PUBLIC_KEY_PEM)) as unknown as typeof fetch,
      });

      vi.advanceTimersByTime(60 * 60 * 1000 + 1000); // un peu plus d'une heure.

      let refetched = false;
      const outcome = await verifyEbaySignature(body, header, {
        ...CONFIG,
        fetchImpl: fetchSequence(async () => {
          refetched = true;
          return fetchReturningKey(PUBLIC_KEY_PEM)();
        }) as unknown as typeof fetch,
      });

      expect(refetched).toBe(true);
      expect(outcome.valid).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
