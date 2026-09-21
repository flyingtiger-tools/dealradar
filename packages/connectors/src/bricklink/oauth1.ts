import { createHmac } from "node:crypto";

/**
 * Signature OAuth 1.0a (RFC 5849, HMAC-SHA1) — BrickLink API v3 exige ce
 * schéma pour CHAQUE requête (contrairement à eBay/OAuth2, aucun jeton
 * d'accès unique réutilisable : chaque appel porte sa propre signature).
 * Implémentation autonome, aucune dépendance externe (`node:crypto`
 * uniquement) — jamais un secret loggué, jamais un secret dans un message
 * d'erreur.
 */

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

export interface OAuth1SignOptions {
  method: string;
  url: string;
  /** Paramètres de requête (query string) — jamais le corps JSON, BrickLink ne signe que la query string. */
  queryParams?: Record<string, string>;
  /** Injectable pour un résultat déterministe en test — `Date.now()`/aléatoire réel par défaut en production. */
  nonce?: () => string;
  timestamp?: () => string;
}

/** Encodage pourcentage RFC 3986 strict — `encodeURIComponent` seul ne suffit pas : `!`, `*`, `'`, `(`, `)` doivent aussi être encodés (OAuth 1.0a l'exige, contrairement à l'URI JavaScript standard). */
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function defaultNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/** Chaîne de base (RFC 5849 §3.4.1) : méthode + URL + paramètres OAuth+query triés et encodés — c'est CE QUI EST SIGNÉ, jamais l'inverse. */
export function buildSignatureBaseString(method: string, url: string, allParams: Record<string, string>): string {
  const sortedEncodedParams = Object.entries(allParams)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort(([ka, va], [kb, vb]) => (ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  return [method.toUpperCase(), percentEncode(url), percentEncode(sortedEncodedParams)].join("&");
}

/** Construit l'en-tête `Authorization: OAuth ...` complet — chaque appelant (client HTTP BrickLink) l'utilise tel quel, jamais reconstruit ailleurs. */
export function signOAuth1Request(credentials: OAuth1Credentials, options: OAuth1SignOptions): string {
  const nonce = (options.nonce ?? defaultNonce)();
  const timestamp = (options.timestamp ?? defaultTimestamp)();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_token: credentials.token,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...(options.queryParams ?? {}) };
  const baseString = buildSignatureBaseString(options.method, options.url, allParams);
  const signingKey = `${percentEncode(credentials.consumerSecret)}&${percentEncode(credentials.tokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const headerValue = Object.entries(headerParams)
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth ${headerValue}`;
}
