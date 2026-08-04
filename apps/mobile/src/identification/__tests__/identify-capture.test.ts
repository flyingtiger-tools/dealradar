import { identifyCapture } from "../identify-capture";
import type { CategoryAdapter, IdentificationCandidate, RafAnalysis } from "../types";
import type { UniversalCaptureResult } from "../../capture/types";

function fakeCapture(): UniversalCaptureResult {
  return {
    captureType: "camera",
    normalizedImage: { uri: "file://x.jpg", width: 1200, height: 1600, format: "jpeg" },
    detectedRegions: [],
    barcodes: [],
    orientation: { exifOrientation: 1, pixelsPhysicallyRotated: true },
    qualitySignals: {
      originalWidth: 1200,
      originalHeight: 1600,
      fileSizeBytes: 500_000,
      exposureTimeSeconds: null,
      isoSpeed: null,
      assumedRegionCropWidth: 900,
      assumedRegionCropHeight: 1200,
    },
    warnings: [],
  };
}

function successResult(): RafAnalysis {
  return {
    category: "pokemon_tcg",
    status: "identified",
    product: { name: "Nymble", setName: "Phantasmal Flames", collectorNumber: "096", language: "en" },
    confidence: 0.9,
    decision: null,
    valuation: { low: 1, high: 2, currency: "CHF" },
    evidence: [],
    missingInformation: [],
    risks: [],
    analysisId: "analysis-1",
  };
}

function fakeAdapter(overrides: Partial<CategoryAdapter> = {}): CategoryAdapter {
  return {
    category: "pokemon_tcg",
    canHandle: (): IdentificationCandidate => ({ category: "pokemon_tcg", confidence: 1, evidence: ["explicit_category_selection"], missingFields: [] }),
    analyze: async () => successResult(),
    ...overrides,
  };
}

describe("identifyCapture — routage", () => {
  it("route une capture vers l'adaptateur dont canHandle revendique la plus haute confiance", async () => {
    const analyzeSpy = jest.fn(async () => successResult());
    const adapter = fakeAdapter({ analyze: analyzeSpy });

    const result = await identifyCapture(fakeCapture(), "pokemon_tcg", [adapter]);

    expect(analyzeSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("identified");
    expect(result.category).toBe("pokemon_tcg");
  });

  it("retourne insufficient_data (category null) lorsqu'aucun adaptateur ne revendique la capture", async () => {
    const analyzeSpy = jest.fn(async () => successResult());
    const adapter = fakeAdapter({
      canHandle: (): IdentificationCandidate => ({ category: null, confidence: 0, evidence: [], missingFields: ["categoryHint"] }),
      analyze: analyzeSpy,
    });

    const result = await identifyCapture(fakeCapture(), null, [adapter]);

    expect(result.status).toBe("insufficient_data");
    expect(result.category).toBeNull();
    expect(result.missingInformation).toContain("categoryHint");
  });

  it("ne déclenche jamais analyze() quand aucun adaptateur n'est exploitable — aucun appel IA inutile", async () => {
    const analyzeSpy = jest.fn(async () => successResult());
    const adapter = fakeAdapter({
      canHandle: (): IdentificationCandidate => ({ category: null, confidence: 0, evidence: [], missingFields: [] }),
      analyze: analyzeSpy,
    });

    await identifyCapture(fakeCapture(), null, [adapter]);

    expect(analyzeSpy).not.toHaveBeenCalled();
  });

  it("remonte une erreur inattendue de l'adaptateur comme un résultat failed, jamais une exception", async () => {
    const adapter = fakeAdapter({
      analyze: async () => {
        throw new Error("panne réseau imprévue");
      },
    });

    const result = await identifyCapture(fakeCapture(), "pokemon_tcg", [adapter]);

    expect(result.status).toBe("failed");
    expect(result.risks).toContain("panne réseau imprévue");
  });

  it("liste vide d'adaptateurs : insufficient_data, jamais une exception", async () => {
    const result = await identifyCapture(fakeCapture(), "pokemon_tcg", []);
    expect(result.status).toBe("insufficient_data");
  });
});
