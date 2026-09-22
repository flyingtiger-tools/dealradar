import { normalizeBarcodeToGtin, selectBestBarcodeForLookup } from "../normalize-barcode";
import type { DetectedBarcode } from "../types";

function fakeBarcode(overrides: Partial<DetectedBarcode> = {}): DetectedBarcode {
  return { format: "ean13", rawValue: "3017620422003", boundingBox: null, ...overrides };
}

describe("normalizeBarcodeToGtin", () => {
  it("ean13 : chiffres transmis tels quels, jamais un padding inventé", () => {
    expect(normalizeBarcodeToGtin(fakeBarcode({ format: "ean13", rawValue: "3017620422003" }))).toBe("3017620422003");
  });

  it("ean8 : accepté", () => {
    expect(normalizeBarcodeToGtin(fakeBarcode({ format: "ean8", rawValue: "12345670" }))).toBe("12345670");
  });

  it("upc_a : accepté", () => {
    expect(normalizeBarcodeToGtin(fakeBarcode({ format: "upc_a", rawValue: "036000291452" }))).toBe("036000291452");
  });

  it("itf14 (GTIN-14 natif) : accepté", () => {
    expect(normalizeBarcodeToGtin(fakeBarcode({ format: "itf14", rawValue: "10036000291452" }))).toBe("10036000291452");
  });

  it("upc_e : jamais normalisé (décision délibérée, algorithme d'expansion jamais vérifié en conditions réelles)", () => {
    expect(normalizeBarcodeToGtin(fakeBarcode({ format: "upc_e", rawValue: "425261" }))).toBeNull();
  });

  it("qr/aztec/pdf417/datamatrix/code39/code93/codabar/code128 : jamais traités comme un GTIN (peuvent encoder n'importe quoi)", () => {
    for (const format of ["qr", "aztec", "pdf417", "datamatrix", "code39", "code93", "codabar", "code128"]) {
      expect(normalizeBarcodeToGtin(fakeBarcode({ format, rawValue: "3017620422003" }))).toBeNull();
    }
  });

  it("valeur sans aucun chiffre : null, jamais une chaîne vide transmise à un appel réseau", () => {
    expect(normalizeBarcodeToGtin(fakeBarcode({ format: "ean13", rawValue: "" }))).toBeNull();
  });
});

describe("selectBestBarcodeForLookup", () => {
  it("aucun code détecté : null", () => {
    expect(selectBestBarcodeForLookup([])).toBeNull();
  });

  it("un seul code GTIN exploitable : sélectionné", () => {
    expect(selectBestBarcodeForLookup([fakeBarcode()])).toBe("3017620422003");
  });

  it("un QR code suivi d'un EAN-13 : le QR est ignoré, l'EAN-13 sélectionné — jamais le premier détecté aveuglément", () => {
    const result = selectBestBarcodeForLookup([fakeBarcode({ format: "qr", rawValue: "https://example.com" }), fakeBarcode({ format: "ean13", rawValue: "3017620422003" })]);
    expect(result).toBe("3017620422003");
  });

  it("uniquement des codes non-GTIN (ou upc_e) : null, jamais un identifiant fabriqué", () => {
    const result = selectBestBarcodeForLookup([fakeBarcode({ format: "qr", rawValue: "x" }), fakeBarcode({ format: "upc_e", rawValue: "425261" })]);
    expect(result).toBeNull();
  });
});
