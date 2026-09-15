const mockUploadTcgCardPhoto = jest.fn();
const mockDeleteTcgCardPhoto = jest.fn();
const mockAnalyzeTcgCard = jest.fn();
let mockRandomUuidCounter = 0;

jest.mock("expo-crypto", () => ({
  randomUUID: () => `mock-uuid-${++mockRandomUuidCounter}`,
}));

class MockTcgUploadError extends Error {}

jest.mock("../../api/tcg-upload-client", () => ({
  uploadTcgCardPhoto: (...args: unknown[]) => mockUploadTcgCardPhoto(...args),
  deleteTcgCardPhoto: (...args: unknown[]) => mockDeleteTcgCardPhoto(...args),
  TcgUploadError: MockTcgUploadError,
}));

// `createAnalysis`/`pollAnalysisUntilSettled` ne doivent JAMAIS être
// appelés depuis ce chemin — mockés uniquement pour satisfaire la
// résolution de module (tcg-adapter.ts les importe toujours), jamais
// utilisés par les assertions ci-dessous.
jest.mock("../../api/analyses-client", () => ({
  createAnalysis: jest.fn(),
  pollAnalysisUntilSettled: jest.fn(),
  AnalysesApiError: class extends Error {},
}));

jest.mock("../../api/tcg-analyze-client", () => ({
  analyzeTcgCard: (...args: unknown[]) => mockAnalyzeTcgCard(...args),
}));

// Ce fichier teste spécifiquement le chemin serverless DIRECT (build
// interne, lot "journée autonome") — force `INTERNAL_TOOLS_ENABLED` à
// `true` explicitement plutôt que de dépendre de `__DEV__` sous Jest (déjà
// `true` par défaut, mais rendu explicite ici pour ne jamais dépendre d'un
// détail d'environnement Jest non documenté).
jest.mock("../../config/internal-tools", () => ({ INTERNAL_TOOLS_ENABLED: true }));

import { tcgAdapter } from "../tcg-adapter";
import type { UniversalCaptureResult } from "../../capture/types";
import type { TcgCardAnalysisResult } from "@dealradar/contracts";

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

const fakeExtractedFields: TcgCardAnalysisResult["extractedFields"] = {
  category: "pokemon_tcg",
  game: "pokemon",
  cardName: "Pikachu",
  setName: "Base Set",
  cardNumber: "58",
  variant: null,
  language: "en",
  productKind: "raw_card",
  gradingCompany: null,
  grade: null,
  confidence: 0.9,
  warnings: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadTcgCardPhoto.mockResolvedValue({ url: "https://storage/analysis-uploads/user-1/req/photo.jpg" });
});

describe("tcgAdapter.analyze — chemin serverless direct (INTERNAL_TOOLS_ENABLED=true)", () => {
  it("appelle analyzeTcgCard({imageUrl}) — jamais createAnalysis/pollAnalysisUntilSettled", async () => {
    mockAnalyzeTcgCard.mockResolvedValue({
      status: "completed",
      result: {
        kind: "pokemon_tcg_card",
        needsConfirmation: false,
        extractedFields: fakeExtractedFields,
        identity: {
          catalogExternalId: "base1-58",
          game: "pokemon",
          name: "Pikachu",
          setName: "Base Set",
          cardNumber: "58",
          variant: null,
          language: "en",
          productKind: "raw_card",
          gradingCompany: null,
          grade: null,
          confidence: 1,
          catalogCorroboration: "corroborated",
        },
        priceObservations: [
          // `currency: "CHF"` directement (plutôt que EUR+conversion) : ce test vérifie le
          // branchement/mapping de tcgAdapter, pas la logique de conversion FX elle-même
          // (déjà couverte ailleurs) — voir fromTcgCardResult dans tcg-adapter.ts, qui ne
          // dérive une fourchette que d'observations natives CHF ou déjà converties.
          { source: "tcgdex", provenance: "cardmarket", amountCents: 963, currency: "CHF", condition: null, variant: null, language: null, gradingCompany: null, grade: null, region: "EU", updatedAt: null, conversion: null, warnings: [] },
        ],
        warnings: [],
        reason: null,
      },
    });

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(mockAnalyzeTcgCard).toHaveBeenCalledTimes(1);
    expect(mockAnalyzeTcgCard).toHaveBeenCalledWith({ imageUrl: "https://storage/analysis-uploads/user-1/req/photo.jpg" });
    expect(result.status).toBe("identified");
    expect(result.product.name).toBe("Pikachu");
    expect(result.valuation).toEqual({ low: 9.63, high: 9.63, currency: "CHF" });
  });

  it("identifiée sans prix : status identified quand même (identity renseignée), jamais un échec total", async () => {
    mockAnalyzeTcgCard.mockResolvedValue({
      status: "insufficient_data",
      result: {
        kind: "pokemon_tcg_card",
        needsConfirmation: false,
        extractedFields: fakeExtractedFields,
        identity: {
          catalogExternalId: "base1-58",
          game: "pokemon",
          name: "Pikachu",
          setName: "Base Set",
          cardNumber: "58",
          variant: null,
          language: "en",
          productKind: "raw_card",
          gradingCompany: null,
          grade: null,
          confidence: 1,
          catalogCorroboration: "corroborated",
        },
        priceObservations: [],
        warnings: [],
        reason: null,
      },
    });

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("identified");
    expect(result.valuation).toEqual({ low: null, high: null, currency: null });
  });

  it("nettoie la photo uploadée après l'appel (best-effort, comme le chemin production)", async () => {
    mockAnalyzeTcgCard.mockResolvedValue({
      status: "insufficient_data",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields, identity: null, priceObservations: [], warnings: [], reason: "catalog_no_match" },
    });

    await tcgAdapter.analyze(fakeCapture());

    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledTimes(1);
  });

  it("réponse d'un mauvais kind : status failed, jamais affichée comme un résultat TCG", async () => {
    mockAnalyzeTcgCard.mockResolvedValue({ status: "failed", result: { product: { name: "x" } } });

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
  });

  it("erreur réseau/serveur : status failed, cleanup quand même déclenché", async () => {
    mockAnalyzeTcgCard.mockRejectedValue(new Error("Impossible de joindre le service."));

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.risks).toContain("Impossible de joindre le service.");
    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledTimes(1);
  });
});
