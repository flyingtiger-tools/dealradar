const mockUploadTcgCardPhoto = jest.fn();
const mockDeleteTcgCardPhoto = jest.fn();
const mockCreateAnalysis = jest.fn();
const mockPollAnalysisUntilSettled = jest.fn();

jest.mock("../../api/tcg-upload-client", () => ({
  uploadTcgCardPhoto: (...args: unknown[]) => mockUploadTcgCardPhoto(...args),
  deleteTcgCardPhoto: (...args: unknown[]) => mockDeleteTcgCardPhoto(...args),
  TcgUploadError: class TcgUploadError extends Error {},
}));

jest.mock("../../api/analyses-client", () => ({
  createAnalysis: (...args: unknown[]) => mockCreateAnalysis(...args),
  pollAnalysisUntilSettled: (...args: unknown[]) => mockPollAnalysisUntilSettled(...args),
  AnalysesApiError: class AnalysesApiError extends Error {},
}));

import { tcgAdapter } from "../tcg-adapter";
import type { UniversalCaptureResult } from "../../capture/types";
import type { AuthContext } from "../types";
import type { TcgCardAnalysisResult } from "@dealradar/contracts";

const AUTH: AuthContext = { accessToken: "token-abc", userId: "user-1" };

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

function fakeExtractedFields(overrides: Partial<TcgCardAnalysisResult["extractedFields"]> = {}): TcgCardAnalysisResult["extractedFields"] {
  return {
    category: "pokemon_tcg",
    game: "pokemon",
    cardName: "Nymble",
    setName: "Phantasmal Flames",
    cardNumber: "096",
    variant: null,
    language: "en",
    productKind: "raw_card",
    gradingCompany: null,
    grade: null,
    confidence: 0.87,
    warnings: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadTcgCardPhoto.mockResolvedValue({ url: "https://storage/analysis-uploads/user-1/req/photo.jpg" });
  mockCreateAnalysis.mockResolvedValue({ id: "analysis-1", status: "pending", result: null });
});

describe("tcgAdapter.canHandle", () => {
  it("revendique la capture uniquement sur route explicite (categoryHint === pokemon_tcg)", () => {
    const candidate = tcgAdapter.canHandle(fakeCapture(), "pokemon_tcg");
    expect(candidate).toEqual({ category: "pokemon_tcg", confidence: 1, evidence: ["explicit_category_selection"], missingFields: [] });
  });

  it("ne revendique jamais la capture sans route explicite — jamais une reconnaissance automatique inventée", () => {
    const candidate = tcgAdapter.canHandle(fakeCapture(), null);
    expect(candidate.category).toBeNull();
    expect(candidate.confidence).toBe(0);
  });
});

describe("tcgAdapter.analyze — transformation de l'entrée et appel unique au pipeline", () => {
  it("transforme la capture vers le contrat existant et n'appelle chaque étape du pipeline qu'une seule fois", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity: null, priceObservations: [], warnings: [], reason: "catalog_diverged" },
    });

    await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(mockUploadTcgCardPhoto).toHaveBeenCalledTimes(1);
    expect(mockUploadTcgCardPhoto).toHaveBeenCalledWith(AUTH.accessToken, AUTH.userId, expect.any(String), "file://normalized.jpg");
    expect(mockCreateAnalysis).toHaveBeenCalledTimes(1);
    const [, request] = mockCreateAnalysis.mock.calls[0] as [string, { categorySlug: string; imageReferences: { url: string }[]; sourceType: string }];
    expect(request.categorySlug).toBe("pokemon_tcg");
    expect(request.sourceType).toBe("mobile_camera");
    expect(request.imageReferences).toEqual([{ url: "https://storage/analysis-uploads/user-1/req/photo.jpg" }]);
    expect(mockPollAnalysisUntilSettled).toHaveBeenCalledTimes(1);
  });
});

describe("tcgAdapter.analyze — normalisation", () => {
  it("réponse complète (identité corroborée + observations de prix) : status identified, fourchette dérivée des vraies observations", async () => {
    const identity: TcgCardAnalysisResult["identity"] = {
      catalogExternalId: "swsh-96",
      game: "pokemon",
      name: "Nymble",
      setName: "Phantasmal Flames",
      cardNumber: "096",
      variant: null,
      language: "en",
      productKind: "raw_card",
      gradingCompany: null,
      grade: null,
      confidence: 0.95,
      catalogCorroboration: "corroborated",
    };
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: {
        kind: "pokemon_tcg_card",
        needsConfirmation: false,
        extractedFields: fakeExtractedFields(),
        identity,
        priceObservations: [
          { source: "cardmarket", provenance: "market_guide", amountCents: 500, currency: "EUR", condition: null, variant: null, language: null, gradingCompany: null, grade: null, region: "EU", updatedAt: null, conversion: { originalAmountCents: 500, originalCurrency: "EUR", rate: 1.05, rateDate: "2026-08-01", convertedAmountCents: 525, convertedCurrency: "CHF", warning: "" }, warnings: [] },
          { source: "tcgplayer", provenance: "market_guide", amountCents: 600, currency: "USD", condition: null, variant: null, language: null, gradingCompany: null, grade: null, region: "US", updatedAt: null, conversion: { originalAmountCents: 600, originalCurrency: "USD", rate: 0.9, rateDate: "2026-08-01", convertedAmountCents: 540, convertedCurrency: "CHF", warning: "" }, warnings: [] },
        ],
        warnings: [],
        reason: null,
      },
    });

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.status).toBe("identified");
    expect(result.category).toBe("pokemon_tcg");
    expect(result.product).toEqual({ name: "Nymble", setName: "Phantasmal Flames", collectorNumber: "096", language: "en" });
    expect(result.confidence).toBe(0.95);
    expect(result.valuation).toEqual({ low: 5.25, high: 5.4, currency: "CHF" });
    expect(result.analysisId).toBe("analysis-1");
  });

  it("réponse partielle (needsConfirmation) : status needs_confirmation, aucune valuation inventée", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: true, extractedFields: fakeExtractedFields({ cardNumber: null }), identity: null, priceObservations: [], warnings: ["low_confidence_extraction"], reason: null },
    });

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.status).toBe("needs_confirmation");
    expect(result.valuation).toEqual({ low: null, high: null, currency: null });
    expect(result.missingInformation).toContain("cardNumber");
  });

  it("identité null sans confirmation requise (ex. catalog_diverged) : insufficient_data, préserve le diagnostic dans risks", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity: null, priceObservations: [], warnings: [], reason: "catalog_diverged" },
    });

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.status).toBe("insufficient_data");
    expect(result.risks).toContain("catalog_diverged");
  });

  it("passe le numéro collectionneur tel quel (\"096\") sans le renormaliser — la comparaison 96/096 reste la responsabilité exclusive du backend", async () => {
    const identity: TcgCardAnalysisResult["identity"] = {
      catalogExternalId: "swsh-96",
      game: "pokemon",
      name: "Nymble",
      setName: "Phantasmal Flames",
      cardNumber: "096",
      variant: null,
      language: "en",
      productKind: "raw_card",
      gradingCompany: null,
      grade: null,
      confidence: 0.95,
      catalogCorroboration: "corroborated",
    };
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity, priceObservations: [], warnings: [], reason: null },
    });

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.product.collectorNumber).toBe("096");
  });

  it("aucune observation de prix : valuation entièrement null, jamais un prix inventé", async () => {
    const identity: TcgCardAnalysisResult["identity"] = {
      catalogExternalId: "swsh-96",
      game: "pokemon",
      name: "Nymble",
      setName: "Phantasmal Flames",
      cardNumber: "096",
      variant: null,
      language: "en",
      productKind: "raw_card",
      gradingCompany: null,
      grade: null,
      confidence: 0.95,
      catalogCorroboration: "corroborated",
    };
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity, priceObservations: [], warnings: [], reason: null },
    });

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.valuation).toEqual({ low: null, high: null, currency: null });
  });
});

describe("tcgAdapter.analyze — erreurs, jamais une exception qui remonte", () => {
  it("image invalide (upload échoue) : status failed, confidence null, jamais une identité inventée", async () => {
    mockUploadTcgCardPhoto.mockRejectedValue(new Error("Fichier image illisible."));

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.status).toBe("failed");
    expect(result.confidence).toBeNull();
    expect(result.product.name).toBeNull();
    expect(result.risks).toContain("Fichier image illisible.");
    expect(mockCreateAnalysis).not.toHaveBeenCalled();
  });

  it("timeout (le polling rend un statut encore pending) : status failed, message explicite", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "processing", result: null });

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.status).toBe("failed");
    expect(result.risks[0]).toMatch(/délai/i);
  });

  it("réponse backend invalide (result absent alors que status=completed) : status failed", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "completed", result: null });

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.status).toBe("failed");
  });

  it("réponse backend du mauvais kind (générique au lieu de pokemon_tcg_card) : status failed, jamais affichée comme un résultat TCG", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { product: { name: "x", category: null, modelOrReference: null }, conditionEstimated: null, priceDetected: null, marketValueEstimate: null, resaleRangeConservative: null, grossMargin: null, estimatedFees: null, netMargin: null, confidenceScore: 50, liquidityScore: 50, dealScore: null, decision: "REVIEW", warnings: [], reasons: [], dataAvailability: { soldTransactions: false, marketGuide: false } },
    });

    const result = await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(result.status).toBe("failed");
  });

  it("nettoie la photo uploadée même en cas d'échec après upload (best-effort, jamais bloquant)", async () => {
    mockCreateAnalysis.mockRejectedValue(new Error("HTTP 500"));

    await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledTimes(1);
  });

  it("ne tente pas de nettoyer une photo qui n'a jamais été uploadée", async () => {
    mockUploadTcgCardPhoto.mockRejectedValue(new Error("Fichier image illisible."));

    await tcgAdapter.analyze(fakeCapture(), AUTH);

    expect(mockDeleteTcgCardPhoto).not.toHaveBeenCalled();
  });
});
