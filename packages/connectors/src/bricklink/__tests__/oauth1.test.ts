import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSignatureBaseString, signOAuth1Request, type OAuth1Credentials } from "../oauth1";

const CREDENTIALS: OAuth1Credentials = { consumerKey: "CK", consumerSecret: "CS", token: "TK", tokenSecret: "TS" };
const URL = "https://api.bricklink.com/api/store/v1/items/PART/3001/price";

describe("buildSignatureBaseString", () => {
  it("trie les paramètres alphabétiquement par clé et encode correctement l'URL/les paramètres (RFC 5849 §3.4.1)", () => {
    // Dérivé à la main d'après la RFC : méthode + '&' + URL%-encodée + '&' + (paramètres triés, joints par '&' puis %-encodés en bloc).
    const expected =
      "GET&" +
      "https%3A%2F%2Fapi.bricklink.com%2Fapi%2Fstore%2Fv1%2Fitems%2FPART%2F3001%2Fprice" +
      "&" +
      encodeURIComponent(
        "guide_type=sold&new_or_used=N&oauth_consumer_key=CK&oauth_nonce=abc123&oauth_signature_method=HMAC-SHA1&oauth_timestamp=1000000000&oauth_token=TK&oauth_version=1.0",
      );

    const actual = buildSignatureBaseString("GET", URL, {
      guide_type: "sold",
      new_or_used: "N",
      oauth_consumer_key: "CK",
      oauth_token: "TK",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1000000000",
      oauth_nonce: "abc123",
      oauth_version: "1.0",
    });

    expect(actual).toBe(expected);
  });

  it("l'ordre d'insertion des paramètres n'affecte jamais le résultat (toujours trié)", () => {
    const a = buildSignatureBaseString("GET", URL, { b: "2", a: "1", c: "3" });
    const b = buildSignatureBaseString("GET", URL, { c: "3", a: "1", b: "2" });
    expect(a).toBe(b);
  });
});

describe("signOAuth1Request", () => {
  const fixedNonceTimestamp = { nonce: () => "abc123", timestamp: () => "1000000000" };

  it("produit une signature vérifiable indépendamment via node:crypto (jamais tautologique — la chaîne de base attendue est écrite à la main ici, pas recalculée via l'implémentation)", () => {
    const expectedBaseString =
      "GET&" +
      "https%3A%2F%2Fapi.bricklink.com%2Fapi%2Fstore%2Fv1%2Fitems%2FPART%2F3001%2Fprice" +
      "&" +
      encodeURIComponent(
        "guide_type=sold&new_or_used=N&oauth_consumer_key=CK&oauth_nonce=abc123&oauth_signature_method=HMAC-SHA1&oauth_timestamp=1000000000&oauth_token=TK&oauth_version=1.0",
      );
    const expectedSigningKey = "CS&TS";
    const expectedSignature = createHmac("sha1", expectedSigningKey).update(expectedBaseString).digest("base64");

    const header = signOAuth1Request(CREDENTIALS, {
      method: "GET",
      url: URL,
      queryParams: { guide_type: "sold", new_or_used: "N" },
      ...fixedNonceTimestamp,
    });

    expect(header).toContain(`oauth_signature="${encodeURIComponent(expectedSignature)}"`);
  });

  it("en-tête Authorization : contient exactement les 7 champs OAuth attendus", () => {
    const header = signOAuth1Request(CREDENTIALS, { method: "GET", url: URL, ...fixedNonceTimestamp });
    for (const field of ["oauth_consumer_key", "oauth_token", "oauth_signature_method", "oauth_timestamp", "oauth_nonce", "oauth_version", "oauth_signature"]) {
      expect(header).toContain(`${field}=`);
    }
    expect(header.startsWith("OAuth ")).toBe(true);
  });

  it("jamais le consumer secret ni le token secret en clair dans l'en-tête produit", () => {
    const header = signOAuth1Request(CREDENTIALS, { method: "GET", url: URL, ...fixedNonceTimestamp });
    expect(header).not.toContain("CS");
    expect(header).not.toContain("TS");
  });

  it("mêmes entrées (nonce/timestamp fixés) -> même signature, déterministe", () => {
    const a = signOAuth1Request(CREDENTIALS, { method: "GET", url: URL, ...fixedNonceTimestamp });
    const b = signOAuth1Request(CREDENTIALS, { method: "GET", url: URL, ...fixedNonceTimestamp });
    expect(a).toBe(b);
  });

  it("un paramètre de requête différent change la signature — preuve que tous les paramètres entrent bien dans le calcul", () => {
    const a = signOAuth1Request(CREDENTIALS, { method: "GET", url: URL, queryParams: { guide_type: "sold" }, ...fixedNonceTimestamp });
    const b = signOAuth1Request(CREDENTIALS, { method: "GET", url: URL, queryParams: { guide_type: "stock" }, ...fixedNonceTimestamp });
    expect(a).not.toBe(b);
  });

  it("un secret différent change la signature", () => {
    const a = signOAuth1Request(CREDENTIALS, { method: "GET", url: URL, ...fixedNonceTimestamp });
    const b = signOAuth1Request({ ...CREDENTIALS, consumerSecret: "OTHER" }, { method: "GET", url: URL, ...fixedNonceTimestamp });
    expect(a).not.toBe(b);
  });
});
