import { crc32 } from "../crc32";

/** Encodeur ASCII minimal pour ces tests (toutes les chaînes utilisées sont ASCII) — évite toute dépendance à un global spécifique à l'environnement (Buffer/TextEncoder). */
function utf8(str: string): Uint8Array {
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}

describe("crc32", () => {
  it("chaîne vide : 0", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("vecteur de test standard CRC-32/ISO-HDLC : \"123456789\" -> 0xCBF43926", () => {
    expect(crc32(utf8("123456789"))).toBe(0xcbf43926);
  });

  it("est déterministe (même entrée -> même sortie)", () => {
    const data = utf8("dealradar");
    expect(crc32(data)).toBe(crc32(data));
  });

  it("détecte une altération d'un seul octet", () => {
    const a = utf8("dealradar-tcg-dataset");
    const b = utf8("dealradar-tcg-datasey"); // dernier caractère modifié
    expect(crc32(a)).not.toBe(crc32(b));
  });
});
