import { decodeJwtUserId } from "../src/api/decode-jwt-user-id";

/** Même encodage base64url que la source (`decode-jwt-user-id.ts`) — jamais `Buffer` (indisponible côté React Native, voir tsconfig sans `@types/node`). */
function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe("decodeJwtUserId", () => {
  it("extrait sub d'un JWT bien formé", () => {
    const token = makeJwt({ sub: "11111111-1111-1111-1111-111111111111", role: "authenticated" });
    expect(decodeJwtUserId(token)).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("retourne null pour un jeton mal formé (pas trois segments)", () => {
    expect(decodeJwtUserId("not-a-jwt")).toBeNull();
  });

  it("retourne null si le payload n'a pas de sub", () => {
    const token = makeJwt({ role: "authenticated" });
    expect(decodeJwtUserId(token)).toBeNull();
  });

  it("retourne null pour un payload JSON invalide, jamais un crash", () => {
    const token = `header.${base64UrlEncode("not-json")}.sig`;
    expect(decodeJwtUserId(token)).toBeNull();
  });
});
