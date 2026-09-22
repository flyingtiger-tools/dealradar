const mockUploadTcgCardPhoto = jest.fn();
const mockDeleteTcgCardPhoto = jest.fn();
const mockCreateAnalysis = jest.fn();
const mockPollAnalysisUntilSettled = jest.fn();
let mockRandomUuidCounter = 0;

// `Crypto.randomUUID()` appelle un module natif (`ExpoCrypto`) indisponible
// sous Jest — fonctionne normalement sur un vrai appareil/build, mais
// retourne `undefined` sans ce mock explicite (même schéma que les autres
// modules natifs déjà mockés ailleurs dans ce projet, ex. expo-image-manipulator).
jest.mock("expo-crypto", () => ({
  randomUUID: () => `mock-uuid-${++mockRandomUuidCounter}`,
}));

// Classes définies À L'INTÉRIEUR de chaque factory `jest.mock(...)` (jamais
// `class Foo {}` déclarée à l'extérieur, même préfixée "mock") — bug de
// hoisting réel trouvé/corrigé ce lot (LOT "Product History UX + Source
// Health + Interactive Cancellation + Beta Readiness", audit section 12) :
// `jest.mock()` est hoisté au-dessus de TOUTE déclaration du fichier
// (classes incluses), donc une classe déclarée hors factory y est
// `undefined` au moment où la factory s'exécute — jamais détecté ici avant
// car `AnalysesApiError` n'était jamais exercée via `instanceof` par le
// code source réel (voir generic-object-adapter.test.ts pour le même
// correctif). Les tests qui ont besoin de construire une instance
// récupèrent la MÊME classe via `jest.requireMock(...)` plus bas.
jest.mock("../../api/tcg-upload-client", () => ({
  uploadTcgCardPhoto: (...args: unknown[]) => mockUploadTcgCardPhoto(...args),
  deleteTcgCardPhoto: (...args: unknown[]) => mockDeleteTcgCardPhoto(...args),
  TcgUploadError: class extends Error {},
}));

jest.mock("../../api/analyses-client", () => ({
  createAnalysis: (...args: unknown[]) => mockCreateAnalysis(...args),
  pollAnalysisUntilSettled: (...args: unknown[]) => mockPollAnalysisUntilSettled(...args),
  AnalysesApiError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  AnalysisPollAbortedError: class extends Error {},
}));

const { AnalysesApiError: MockAnalysesApiError, AnalysisPollAbortedError: MockAnalysisPollAbortedError } = jest.requireMock(
  "../../api/analyses-client",
) as { AnalysesApiError: new (code: string, message: string) => Error; AnalysisPollAbortedError: new () => Error };
const { TcgUploadError: MockTcgUploadError } = jest.requireMock("../../api/tcg-upload-client") as { TcgUploadError: new (message?: string) => Error };

// Ce fichier teste le chemin PRODUCTION (file d'attente pg-boss + worker,
// jamais supprimé — voir tcg-adapter.ts) : force `INTERNAL_TOOLS_ENABLED`
// à `false` explicitement, sans quoi `__DEV__ === true` sous Jest ferait
// systématiquement prendre le nouveau chemin serverless direct (voir
// tcg-analyze-client.test.ts pour CE chemin). `tcg-analyze-client` reste
// mocké même si sa branche n'est jamais exécutée ici : l'import statique
// de `tcg-adapter.ts` le charge quoi qu'il arrive (transitivement jusqu'à
// `react-native-url-polyfill`, jamais transformable sous Jest sans mock).
jest.mock("../../config/internal-tools", () => ({ INTERNAL_TOOLS_ENABLED: false }));
jest.mock("../../api/tcg-analyze-client", () => ({ analyzeTcgCard: jest.fn() }));

import { tcgAdapter } from "../tcg-adapter";
import type { UniversalCaptureResult } from "../../capture/types";
import type { TcgCardAnalysisResult } from "@dealradar/contracts";

/**
 * Signatures alignées sur le refactor auth (LOT 9) — `uploadTcgCardPhoto`,
 * `createAnalysis`, `pollAnalysisUntilSettled` et `deleteTcgCardPhoto` ne
 * prennent plus ni `accessToken` ni `userId` : ces fonctions tirent
 * elles-mêmes l'identité de la session Supabase courante. Ce test vérifie
 * uniquement que `tcgAdapter` les appelle avec les BONS arguments restants
 * — pas la logique de session elle-même, déjà couverte par
 * `__tests__/session.test.ts` et `__tests__/tcg-upload-client.test.ts`.
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

describe("tcgAdapter.analyze — transformation de l'entrée et appel unique au pipeline (signatures session-based)", () => {
  it("appelle uploadTcgCardPhoto(clientRequestId, uri) sans accessToken/userId, et chaque étape une seule fois", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity: null, priceObservations: [], warnings: [], reason: "catalog_diverged" },
    });

    await tcgAdapter.analyze(fakeCapture());

    expect(mockUploadTcgCardPhoto).toHaveBeenCalledTimes(1);
    expect(mockUploadTcgCardPhoto).toHaveBeenCalledWith(expect.any(String), "file://normalized.jpg");

    expect(mockCreateAnalysis).toHaveBeenCalledTimes(1);
    const [request] = mockCreateAnalysis.mock.calls[0] as [{ categorySlug: string; imageReferences: { url: string }[]; sourceType: string }];
    expect(request.categorySlug).toBe("pokemon_tcg");
    expect(request.sourceType).toBe("mobile_camera");
    expect(request.imageReferences).toEqual([{ url: "https://storage/analysis-uploads/user-1/req/photo.jpg" }]);

    expect(mockPollAnalysisUntilSettled).toHaveBeenCalledTimes(1);
    // `{ signal: undefined }` (jamais juste "analysis-1" seul) depuis ce
    // lot — `tcg-adapter.ts` transmet désormais toujours un `signal`
    // (parité défensive avec `generic-object-adapter.ts`, voir l'audit
    // beta-readiness section 12), `undefined` en l'absence d'appelant qui
    // en fournit un.
    expect(mockPollAnalysisUntilSettled).toHaveBeenCalledWith("analysis-1", { signal: undefined });
  });

  it("rapporte la progression réelle (uploading -> submitting -> polling) dans l'ordre, jamais une progression fabriquée", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity: null, priceObservations: [], warnings: [], reason: "catalog_diverged" },
    });
    const phases: string[] = [];

    await tcgAdapter.analyze(fakeCapture(), (phase) => phases.push(phase));

    expect(phases).toEqual(["uploading", "submitting", "polling"]);
  });

  it("sans callback onProgress fourni : fonctionne normalement (paramètre optionnel)", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity: null, priceObservations: [], warnings: [], reason: "catalog_diverged" },
    });

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("insufficient_data");
  });

  it("appelle deleteTcgCardPhoto(clientRequestId) seul, sans accessToken/userId", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity: null, priceObservations: [], warnings: [], reason: "catalog_diverged" },
    });

    await tcgAdapter.analyze(fakeCapture());

    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledTimes(1);
    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledWith(expect.any(String));
  });

  it("le même clientRequestId est utilisé pour l'upload et la suppression", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { kind: "pokemon_tcg_card", needsConfirmation: false, extractedFields: fakeExtractedFields(), identity: null, priceObservations: [], warnings: [], reason: "catalog_diverged" },
    });

    await tcgAdapter.analyze(fakeCapture());

    const uploadId = mockUploadTcgCardPhoto.mock.calls[0][0];
    const deleteId = mockDeleteTcgCardPhoto.mock.calls[0][0];
    expect(uploadId).toBe(deleteId);
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

    const result = await tcgAdapter.analyze(fakeCapture());

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

    const result = await tcgAdapter.analyze(fakeCapture());

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

    const result = await tcgAdapter.analyze(fakeCapture());

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

    const result = await tcgAdapter.analyze(fakeCapture());

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

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.valuation).toEqual({ low: null, high: null, currency: null });
  });
});

describe("tcgAdapter.analyze — session absente ou expirée", () => {
  it("aucune session active dès l'upload (TcgUploadError du client) : status failed, message préservé, jamais un appel réseau suivant", async () => {
    mockUploadTcgCardPhoto.mockRejectedValue(new MockTcgUploadError("Aucune session active — connecte-toi avant d'envoyer une photo."));

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.confidence).toBeNull();
    expect(result.risks).toContain("Aucune session active — connecte-toi avant d'envoyer une photo.");
    expect(mockCreateAnalysis).not.toHaveBeenCalled();
  });

  it("session expirée entre l'upload et la création de l'analyse (AnalysesApiError UNAUTHENTICATED) : status failed, cleanup quand même déclenché", async () => {
    mockCreateAnalysis.mockRejectedValue(new MockAnalysesApiError("UNAUTHENTICATED", "Aucune session active — connecte-toi avant de lancer une analyse."));

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.risks).toContain("Aucune session active — connecte-toi avant de lancer une analyse.");
    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledTimes(1);
  });
});

describe("tcgAdapter.analyze — erreurs, jamais une exception qui remonte", () => {
  it("image invalide (upload échoue) : status failed, confidence null, jamais une identité inventée", async () => {
    mockUploadTcgCardPhoto.mockRejectedValue(new Error("Fichier image illisible."));

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.confidence).toBeNull();
    expect(result.product.name).toBeNull();
    expect(result.risks).toContain("Fichier image illisible.");
    expect(mockCreateAnalysis).not.toHaveBeenCalled();
  });

  it("timeout (le polling rend un statut encore pending) : status failed, message explicite", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "processing", result: null });

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.risks[0]).toMatch(/délai/i);
  });

  it("réponse backend invalide (result absent alors que status=completed) : status failed", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "completed", result: null });

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
  });

  it("réponse backend du mauvais kind (générique au lieu de pokemon_tcg_card) : status failed, jamais affichée comme un résultat TCG", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({
      id: "analysis-1",
      status: "completed",
      result: { product: { name: "x", category: null, modelOrReference: null }, conditionEstimated: null, priceDetected: null, marketValueEstimate: null, resaleRangeConservative: null, grossMargin: null, estimatedFees: null, netMargin: null, confidenceScore: 50, liquidityScore: 50, dealScore: null, decision: "REVIEW", warnings: [], reasons: [], dataAvailability: { soldTransactions: false, marketGuide: false } },
    });

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
  });

  it("nettoie la photo uploadée même en cas d'échec après upload (best-effort, jamais bloquant)", async () => {
    mockCreateAnalysis.mockRejectedValue(new Error("HTTP 500"));

    await tcgAdapter.analyze(fakeCapture());

    expect(mockDeleteTcgCardPhoto).toHaveBeenCalledTimes(1);
  });

  it("ne tente pas de nettoyer une photo qui n'a jamais été uploadée", async () => {
    mockUploadTcgCardPhoto.mockRejectedValue(new Error("Fichier image illisible."));

    await tcgAdapter.analyze(fakeCapture());

    expect(mockDeleteTcgCardPhoto).not.toHaveBeenCalled();
  });
});

describe("tcgAdapter.analyze (chemin file d'attente) — parité annulation défensive (trouvaille d'audit beta-readiness, section 12 du LOT 'Product History UX + Source Health + Interactive Cancellation + Beta Readiness')", () => {
  // AUCUN appelant ne fournit encore de bouton d'annulation pour la
  // verticale TCG aujourd'hui (`TcgScanScreen.tsx` ne passe jamais
  // `onCancel`/`signal` — règle produit explicite du lot) : ces tests
  // vérifient seulement que `tcg-adapter.ts` ne romprait PAS silencieusement
  // une future annulation TCG, jamais qu'un bouton existe déjà.
  it("rapporte analysisId au passage en phase 'polling' (comme generic-object-adapter.ts), jamais pour 'uploading'/'submitting'", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "processing", result: null });
    const reported: { phase: string; analysisId?: string }[] = [];

    await tcgAdapter.analyze(fakeCapture(), (phase, analysisId) => reported.push({ phase, analysisId }));

    expect(reported).toEqual([
      { phase: "uploading", analysisId: undefined },
      { phase: "submitting", analysisId: undefined },
      { phase: "polling", analysisId: "analysis-1" },
    ]);
  });

  it("transmet le signal fourni à pollAnalysisUntilSettled", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "processing", result: null });
    const controller = new AbortController();

    await tcgAdapter.analyze(fakeCapture(), undefined, controller.signal);

    const [, options] = mockPollAnalysisUntilSettled.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(options.signal).toBe(controller.signal);
  });

  it("polling arrêté côté client (AnalysisPollAbortedError) : status failed avec un message honnête d'annulation, jamais une exception qui remonte", async () => {
    mockPollAnalysisUntilSettled.mockRejectedValue(new MockAnalysisPollAbortedError());

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.risks).toContain("Analyse annulée.");
  });

  it("statut serveur 'cancelled' : status failed avec le même message honnête, jamais une 'réponse inattendue'", async () => {
    mockPollAnalysisUntilSettled.mockResolvedValue({ id: "analysis-1", status: "cancelled", result: null });

    const result = await tcgAdapter.analyze(fakeCapture());

    expect(result.status).toBe("failed");
    expect(result.risks).toContain("Analyse annulée.");
  });
});
