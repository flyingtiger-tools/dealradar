const mockUploadTcgCardPhoto = jest.fn();
const mockDeleteTcgCardPhoto = jest.fn();
const mockCreateAnalysis = jest.fn();
const mockPollAnalysisUntilSettled = jest.fn();
let mockRandomUuidCounter = 0;

jest.mock("expo-crypto", () => ({
  randomUUID: () => `mock-uuid-${++mockRandomUuidCounter}`,
}));

class MockTcgUploadError extends Error {}
class MockAnalysesApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

jest.mock("../../api/tcg-upload-client", () => ({
  uploadTcgCardPhoto: (...args: unknown[]) => mockUploadTcgCardPhoto(...args),
  deleteTcgCardPhoto: (...args: unknown[]) => mockDeleteTcgCardPhoto(...args),
  TcgUploadError: MockTcgUploadError,
}));

jest.mock("../../api/analyses-client", () => ({
  createAnalysis: (...args: unknown[]) => mockCreateAnalysis(...args),
  pollAnalysisUntilSettled: (...args: unknown[]) => mockPollAnalysisUntilSettled(...args),
  AnalysesApiError: MockAnalysesApiError,
}));

import { createGenericObjectAdapter, GENERIC_CATEGORIES, genericObjectAdapters } from "../generic-object-adapter";
import type { UniversalCaptureResult } from "../../capture/types";
import type { AnalysisResult } from "@dealradar/contracts";

/**
 * Même schéma de test que `tcg-adapter.test.ts` — l'adaptateur générique
 * suit exactement la même discipline (canHandle explicite, analyze jamais
 * bloquant), seule la normalisation du résultat diffère (AnalysisResult au
 * lieu de TcgCardAnalysisResult, échelle de confiance 0-100 -> 0-1).
 */

function fakeCapture(): UniversalCaptureResult {
  return {
    captureType: "camera",
    normalizedImage: { uri: "file://normalized.jpg", width: 1200, height: 1600, format: "jpeg" },
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

function fakeAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    product: { name: "Rolex Submariner", category: "watches", modelOrReference: "116610LN" },
    conditionEstimated: "very_good",
    priceDetected: { amount: 8000, currency: "CHF" },
    marketValueEstimate: { amount: 8500, currency: "CHF", provenance: "sold_transaction" },
    resaleRangeConservative: { low: 8200, high: 8800, currency: "CHF" },
    grossMargin: 500,
    estimatedFees: 100,
    netMargin: 400,
    confidenceScore: 78,
    liquidityScore: 60,
    dealScore: 65,
    decision: "REVIEW",
    warnings: [],
    reasons: ["Marge nette prometteuse."],
    dataAvailability: { soldTransactions: true, marketGuide: false },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadTcgCardPhoto.mockResolvedValue({ url: "https://storage/analysis-uploads/user-1/req/photo.jpg" });
  mockCreateAnalysis.mockResolvedValue({ id: "analysis-1", status: "pending", result: null });
});

describe("GENERIC_CATEGORIES / genericObjectAdapters", () => {
  it("couvre toutes les catégories sauf pokemon_tcg, une seule instance par catégorie", () => {
    expect(GENERIC_CATEGORIES).not.toContain("pokemon_tcg");
    expect(genericObjectAdapters).toHaveLength(GENERIC_CATEGORIES.length);
    expect(genericObjectAdapters.map((a) => a.category).sort()).toEqual([...GENERIC_CATEGORIES].sort());
  });
});

describe("createGenericObjectAdapter(...).canHandle", () => {
  const adapter = createGenericObjectAdapter("watches");

  it("revendique la capture uniquement sur route explicite (categoryHint === sa catégorie)", () => {
    const candidate = adapter.canHandle(fakeCapture(), "watches");
    expect(candidate).toEqual({ category: "watches", confidence: 1, evidence: ["explicit_category_selection"], missingFields: [] });
  });

  it("ne revendique jamais la capture pour une autre catégorie ou sans route explicite", () => {
    expect(adapter.canHandle(fakeCapture(), null).category).toBeNull();
    expect(adapter.canHandle(fakeCapture(), "sneakers").category).toBeNull();
  });
});

describe("createGenericObjectAdapter(...).analyze — flux réseau", () => {
  const adapter = createGenericObjectAdapter("watches");

  it("upload -> createAnalysis(categorySlug: 'watches') -> poll, dans l'ordre, chacun une seule fois", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "completed", result: fakeAnalysisResult() });

    await adapter.analyze(fakeCapture());

    expect(mockUploadTcgCardPhoto).toHaveBeenCalledTimes(1);
    expect(mockCreateAnalysis).toHaveBeenCalledTimes(1);
    const [request] = mockCreateAnalysis.mock.calls[0] as [{ categorySlug: string }];
    expect(request.categorySlug).toBe("watches");
    expect(mockPollAnalysisUntilSettled).toHaveBeenCalledTimes(1);
  });

  it("rapporte la progression réelle dans l'ordre", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "completed", result: fakeAnalysisResult() });
    const phases: string[] = [];

    await adapter.analyze(fakeCapture(), (phase) => phases.push(phase));

    expect(phases).toEqual(["uploading", "submitting", "polling"]);
  });

  it("nettoie la photo uploadée après traitement (best-effort)", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "completed", result: fakeAnalysisResult() });

    await adapter.analyze(fakeCapture());

    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledTimes(1);
  });
});

describe("createGenericObjectAdapter(...).analyze — normalisation", () => {
  const adapter = createGenericObjectAdapter("watches");

  it("produit identifié : status identified, confiance reconvertie 0-100 -> 0-1 (jamais la même échelle que le backend)", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: fakeAnalysisResult({ confidenceScore: 78 }),
    });

    const result = await adapter.analyze(fakeCapture());

    expect(result.status).toBe("identified");
    expect(result.category).toBe("watches");
    expect(result.confidence).toBeCloseTo(0.78);
    expect(result.product).toEqual({ name: "Rolex Submariner", setName: "watches", collectorNumber: "116610LN", language: null });
    expect(result.decision).toBe("REVIEW");
    expect(result.valuation).toEqual({ low: 8200, high: 8800, currency: "CHF" });
    expect(result.evidence).toEqual(["sold_transaction"]);
    expect(result.analysisId).toBe("analysis-1");
  });

  it("produit non identifié (product.name absent) : insufficient_data, jamais une confiance ou une catégorie inventée", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: fakeAnalysisResult({
        product: { name: null, category: "watches", modelOrReference: null },
        confidenceScore: 0,
        decision: "INSUFFICIENT_DATA",
        warnings: ["CATEGORY_REQUIRED"],
      }),
    });

    const result = await adapter.analyze(fakeCapture());

    expect(result.status).toBe("insufficient_data");
    expect(result.confidence).toBeNull();
    expect(result.risks).toContain("CATEGORY_REQUIRED");
  });

  it("aucune fourchette de revente disponible : valuation entièrement null, jamais un prix inventé", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: fakeAnalysisResult({ resaleRangeConservative: null, marketValueEstimate: null }),
    });

    const result = await adapter.analyze(fakeCapture());

    expect(result.valuation).toEqual({ low: null, high: null, currency: null });
    expect(result.evidence).toEqual([]);
  });

  it("réponse backend du mauvais type (résultat TCG au lieu d'un AnalysisResult générique) : status failed, jamais mal interprété", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: {}, identity: null, priceObservations: [], warnings: [], reason: null },
    });

    const result = await adapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
  });
});

describe("createGenericObjectAdapter(...).analyze — erreurs et timeout, jamais une exception qui remonte", () => {
  const adapter = createGenericObjectAdapter("watches");

  it("timeout (poll rend encore pending) : status failed, message explicite", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "processing", result: null });

    const result = await adapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.risks[0]).toMatch(/délai/i);
  });

  it("upload échoue : status failed, jamais d'appel createAnalysis, jamais de cleanup d'une photo non uploadée", async () => {
    mockUploadTcgCardPhoto.mockRejectedValue(new Error("Fichier image illisible."));

    const result = await adapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.category).toBe("watches");
    expect(mockCreateAnalysis).not.toHaveBeenCalled();
    expect(mockDeleteTcgCardPhoto).not.toHaveBeenCalled();
  });

  it("session expirée (AnalysesApiError) après upload : status failed, cleanup quand même déclenché", async () => {
    mockCreateAnalysis.mockRejectedValue(new MockAnalysesApiError("UNAUTHENTICATED", "Aucune session active."));

    const result = await adapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.risks).toContain("Aucune session active.");
    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledTimes(1);
  });
});
