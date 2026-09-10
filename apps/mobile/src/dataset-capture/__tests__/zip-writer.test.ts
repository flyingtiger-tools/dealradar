import { buildStoredZip, readStoredZipEntries } from "../zip-writer";

function ascii(str: string): Uint8Array {
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}

describe("buildStoredZip / readStoredZipEntries — aller-retour", () => {
  it("archive vide : ZIP structurellement valide, aucune entrée", () => {
    const zip = buildStoredZip([]);
    expect(readStoredZipEntries(zip)).toEqual([]);
  });

  it("une entrée : nom, taille et CRC se relisent correctement", () => {
    const data = ascii('{"provenance":"real","entries":[]}');
    const zip = buildStoredZip([{ path: "dataset.json", data }]);
    const entries = readStoredZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe("dataset.json");
    expect(entries[0]!.size).toBe(data.length);
    expect(entries[0]!.crcValid).toBe(true);
  });

  it("plusieurs entrées, y compris un chemin avec sous-dossier (photos/<id>.jpg)", () => {
    const entries = [
      { path: "dataset.json", data: ascii("{}") },
      { path: "photos/nymble-096.jpg", data: Uint8Array.from([1, 2, 3, 4, 5, 250, 251, 252]) },
      { path: "photos/second-card.jpg", data: Uint8Array.from(Array.from({ length: 500 }, (_, i) => i % 256)) },
    ];
    const zip = buildStoredZip(entries);
    const parsed = readStoredZipEntries(zip);

    expect(parsed).toHaveLength(3);
    expect(parsed.map((e) => e.path)).toEqual(["dataset.json", "photos/nymble-096.jpg", "photos/second-card.jpg"]);
    for (const [i, entry] of parsed.entries()) {
      expect(entry.size).toBe(entries[i]!.data.length);
      expect(entry.crcValid).toBe(true);
    }
  });

  it("un octet altéré dans les données d'une entrée casse la vérification CRC au relais", () => {
    const data = Uint8Array.from([10, 20, 30, 40, 50]);
    const zip = buildStoredZip([{ path: "x.bin", data }]);
    // Corrompt manuellement un octet de données (après l'en-tête local de 30 octets + 5 octets de nom "x.bin").
    const corrupted = new Uint8Array(zip);
    const dataOffset = 30 + "x.bin".length;
    corrupted[dataOffset] = (corrupted[dataOffset]! + 1) & 0xff;
    expect(readStoredZipEntries(corrupted)[0]!.crcValid).toBe(false);
  });

  it("produit une archive plus grande que la somme des données (en-têtes ZIP inclus)", () => {
    const data = ascii("contenu de test");
    const zip = buildStoredZip([{ path: "a.txt", data }]);
    expect(zip.length).toBeGreaterThan(data.length);
  });

  it("les 4 premiers octets sont la signature de fichier local ZIP (0x04034b50, little-endian)", () => {
    const zip = buildStoredZip([{ path: "a.txt", data: ascii("x") }]);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
  });

  it("lever une erreur explicite sur des octets qui ne sont pas un ZIP valide", () => {
    expect(() => readStoredZipEntries(Uint8Array.from([1, 2, 3, 4]))).toThrow();
  });
});
