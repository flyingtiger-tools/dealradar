import type { BarcodeScanningResult } from "expo-camera";
import { dedupeBarcodes, toDetectedBarcode } from "../barcode";

function fakeScan(overrides: Partial<BarcodeScanningResult> = {}): BarcodeScanningResult {
  return {
    type: "ean13",
    data: "1234567890123",
    cornerPoints: [],
    bounds: { origin: { x: 10, y: 20 }, size: { width: 100, height: 50 } },
    ...overrides,
  };
}

describe("toDetectedBarcode", () => {
  it("code-barres reconnu : mappe format/valeur/zone sans logique métier", () => {
    const detected = toDetectedBarcode(fakeScan());
    expect(detected).toEqual({
      format: "ean13",
      rawValue: "1234567890123",
      boundingBox: { x: 10, y: 20, width: 100, height: 50 },
    });
  });

  it("bounds absent : boundingBox null, jamais une valeur inventée", () => {
    const detected = toDetectedBarcode(fakeScan({ bounds: undefined as unknown as BarcodeScanningResult["bounds"] }));
    expect(detected.boundingBox).toBeNull();
  });
});

describe("dedupeBarcodes", () => {
  it("absence de code-barres : liste vide reste vide", () => {
    expect(dedupeBarcodes([])).toEqual([]);
  });

  it("dédoublonne par (format, valeur) — le même code scanné en continu ne produit qu'une entrée", () => {
    const a = toDetectedBarcode(fakeScan());
    const b = toDetectedBarcode(fakeScan());
    const c = toDetectedBarcode(fakeScan({ data: "9999999999999" }));

    expect(dedupeBarcodes([a, b, c])).toHaveLength(2);
  });

  it("deux formats différents portant la même valeur restent distincts", () => {
    const a = toDetectedBarcode(fakeScan({ type: "ean13", data: "123" }));
    const b = toDetectedBarcode(fakeScan({ type: "code128", data: "123" }));
    expect(dedupeBarcodes([a, b])).toHaveLength(2);
  });
});
