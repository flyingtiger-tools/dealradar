import { createVerify } from "node:crypto";
import { createOAuthTokenProvider, ebayApiHost } from "@dealradar/connectors";

/**
 * Vérification de `X-EBAY-SIGNATURE` (ADR 0011) — algorithme confirmé
 * contre le SDK de référence officiel eBay (event-notification-php-sdk,
 * lib/validator.php et lib/client.php, Apache-2.0, github.com/eBay), pas
 * deviné :
 *
 * 1. L'en-tête est du JSON encodé en base64 : `{ kid, signature, ... }`.
 * 2. La clé publique est récupérée via
 *    `GET {host}/commerce/notification/v1/public_key/{kid}` avec un
 *    Bearer token OAuth *application* (client credentials — même flux que
 *    le reste de l'API), réponse `{ key: "<PEM ou base64 brut>" }`.
 * 3. La signature est vérifiée avec un digest **SHA-1** (confirmé
 *    `OPENSSL_ALGO_SHA1` dans le SDK de référence — pas SHA-256, malgré ce
 *    qu'on pourrait attendre d'un schéma récent).
 *
 * **Divergence par rapport au SDK de référence, assumée et documentée** :
 * le SDK PHP re-sérialise le message déjà parsé (`json_encode($message)`)
 * avant de vérifier la signature — risque de non-correspondance
 * octet-pour-octet si le ré-encodage diffère de l'original (ordre des
 * clés, espaces). Cette implémentation vérifie au contraire contre les
 * **octets bruts exacts du corps de la requête**, capturés avant tout
 * parsing JSON — plus robuste, jamais de dépendance à un ré-encodage.
 *
 * **⚠️ Écart à l'ADR 0008** : la récupération de la clé publique exige un
 * token OAuth *application* eBay (`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`),
 * jusqu'ici jamais lus par `apps/web` (ADR 0008 : « jamais dans apps/web »).
 * Il n'existe pas de identifiants eBay á portée réduite pour cet usage
 * seul — c'est le même couple client credentials que pour la Browse API.
 * Décision explicitement soumise à validation, pas tranchée silencieusement
 * — voir ADR 0011, section « Écart ADR 0008 ».
 *
 * **Statut réel, à ne pas confondre avec « vérifié »** : cette
 * implémentation est fidèle à la documentation/au SDK officiels et
 * couverte par des tests avec une paire de clés RSA synthétique générée
 * localement (signature valide/invalide/clé erronée). Elle n'a **jamais**
 * été exercée contre une signature réelle émise par l'infrastructure eBay
 * (aucun identifiant réel disponible) — seulement *préparée*, pas
 * *confirmée en conditions réelles*.
 */

export interface SignatureVerificationConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
  fetchImpl?: typeof fetch;
}

export type SignatureVerificationOutcome =
  | { valid: true }
  | { valid: false; reason: "missing_header" | "malformed_header" | "public_key_fetch_failed" | "signature_mismatch" | "verification_error" };

const KEY_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — recommandation eBay (éviter de sur-solliciter l'API).

interface CachedKey {
  pem: string;
  fetchedAtMs: number;
}

const publicKeyCache = new Map<string, CachedKey>();

/**
 * eBay peut renvoyer la clé déjà encadrée `-----BEGIN/END PUBLIC KEY-----`
 * (potentiellement sur une seule ligne) ou juste le corps base64 — les deux
 * formes sont acceptées, reconstruites en PEM valide (lignes de 64
 * caractères, comme l'exige `openssl`/le SDK de référence).
 */
function toPem(rawKey: string): string {
  const match = rawKey.match(/-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/);
  const body = (match?.[1] ?? rawKey).replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
}

async function fetchPublicKey(kid: string, config: SignatureVerificationConfig): Promise<string> {
  const cached = publicKeyCache.get(kid);
  if (cached && Date.now() - cached.fetchedAtMs < KEY_CACHE_TTL_MS) return cached.pem;

  const fetchImpl = config.fetchImpl ?? fetch;
  // Diagnostic sûr (longueur + espaces superflus uniquement, jamais la
  // valeur) : un copier-coller incluant un espace ou un retour à la ligne
  // invisible casse le Basic Auth sans que rien ne le laisse deviner.
  console.error("eBay account-deletion : identifiants OAuth (diagnostic, aucune valeur) —", {
    clientIdLength: config.clientId.length,
    clientIdHasWhitespace: config.clientId !== config.clientId.trim(),
    clientSecretLength: config.clientSecret.length,
    clientSecretHasWhitespace: config.clientSecret !== config.clientSecret.trim(),
  });
  const tokenProvider = createOAuthTokenProvider(
    { clientId: config.clientId, clientSecret: config.clientSecret, environment: config.environment },
    fetchImpl,
  );
  const token = await tokenProvider.getAccessToken();

  const response = await fetchImpl(
    `${ebayApiHost(config.environment)}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Récupération de la clé publique eBay échouée (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { key?: string };
  if (!body.key) {
    throw new Error("Réponse de clé publique eBay sans champ 'key'.");
  }

  const pem = toPem(body.key);
  publicKeyCache.set(kid, { pem, fetchedAtMs: Date.now() });
  return pem;
}

/**
 * `rawBody` doit être le texte brut exact du corps de la requête, capturé
 * avant `JSON.parse` — jamais un objet re-sérialisé (voir la note sur la
 * divergence avec le SDK de référence, en tête de fichier).
 */
export async function verifyEbaySignature(
  rawBody: string,
  signatureHeader: string | null,
  config: SignatureVerificationConfig,
): Promise<SignatureVerificationOutcome> {
  if (!signatureHeader) return { valid: false, reason: "missing_header" };

  let decoded: { kid?: string; signature?: string };
  try {
    decoded = JSON.parse(Buffer.from(signatureHeader, "base64").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed_header" };
  }
  if (!decoded.kid || !decoded.signature) {
    return { valid: false, reason: "malformed_header" };
  }

  let pem: string;
  try {
    pem = await fetchPublicKey(decoded.kid, config);
  } catch (error) {
    // Diagnostic sûr : ni kid, ni signature, ni identifiants — seulement
    // l'environnement ciblé et le message d'erreur (déjà dépourvu de
    // secrets, voir fetchPublicKey/fetchNewToken : uniquement des codes
    // HTTP ou des messages réseau génériques).
    console.error("eBay account-deletion : échec de récupération de la clé publique —", {
      environment: config.environment,
      message: error instanceof Error ? error.message : "erreur inconnue",
    });
    return { valid: false, reason: "public_key_fetch_failed" };
  }

  try {
    const verifier = createVerify("SHA1");
    verifier.update(rawBody, "utf8");
    verifier.end();
    const isValid = verifier.verify(pem, decoded.signature, "base64");
    return isValid ? { valid: true } : { valid: false, reason: "signature_mismatch" };
  } catch {
    return { valid: false, reason: "verification_error" };
  }
}

/** Réservé aux tests — vide le cache de clés publiques entre les cas. */
export function clearPublicKeyCacheForTests(): void {
  publicKeyCache.clear();
}
