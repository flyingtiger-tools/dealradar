import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../logger";

const extractTcgCardFromPhoto = vi.fn();
const orchestratePokemonPipeline = vi.fn();

vi.mock("@dealradar/ai", () => ({ extractTcgCardFromPhoto: (...args: unknown[]) => extractTcgCardFromPhoto(...args) }));
vi.mock("@dealradar/ingestion", () => ({ orchestratePokemonPipeline: (...args: unknown[]) => orchestratePokemonPipeline(...args) }));

const { processTcgCardAnalysis } = await import("../process-tcg-card-analysis");

/**
 * Teste uniquement la logique de branchement/mapping propre à
 * `process-tcg-card-analysis.ts` — `extractTcgCardFromPhoto` et
 * `orchestratePokemonPipeline` sont déjà couverts en profondeur ailleurs
 * (`packages/ai`, `packages/ingestion`), mockés ici pour isoler ce module.
 */

function fakeDb(signedUrl: string | null = "https://storage.example.test/signed.jpg?token=x"): SupabaseClient {
  const remove = vi.fn(async () => ({ data: null, error: null }));
  return {
    storage: {
      from: () => ({
        createSignedUrl: vi.fn(async () => (signedUrl ? { data: { signedUrl }, error: null } : { data: null, error: { message: "not found" } })),
        remove,
      }),
    },
  } as unknown as SupabaseClient;
}

const fullExtraction = {
  game: { value: "Pokémon", confidence: 0.9 },
  cardName: { value: "Pikachu", confidence: 0.98 },
  setName: { value: "Base Set", confidence: 0.9 },
  cardNumber: { value: "58", confidence: 0.92 },
  variant: { value: "Normal", confidence: 0.85 },
  language: { value: "English", confidence: 0.8 },
  productKind: { value: "raw_card" as const, confidence: 0.9 },
  gradingCompany: { value: null, confidence: 0 },
  grade: { value: null, confidence: 0 },
  overallConfidence: 0.95,
};

const weakExtraction = {
  ...fullExtraction,
  setName: { value: null, confidence: 0 },
  cardNumber: { value: null, confidence: 0 },
  overallConfidence: 0.3,
};

const extractionOptions = { provider: { name: "openai", model: "gpt-4o-mini", extract: vi.fn() } };
const connectors = {
  pokemonCatalogConnector: {},
  tcgdexCatalogConnector: {},
  justTcgPricingConnector: {},
  tcgdexPricingConnector: {},
  fxProvider: {},
} as never;

describe("processTcgCardAnalysis", () => {
  beforeEach(() => {
    extractTcgCardFromPhoto.mockReset();
    orchestratePokemonPipeline.mockReset();
  });

  it("aucune photo fournie : insufficient_data, jamais d'appel extraction/pipeline", async () => {
    const result = await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-1", imageReferences: [], providedTcgHints: null },
      { extractionOptions, connectors },
    );
    expect(result.status).toBe("insufficient_data");
    expect(extractTcgCardFromPhoto).not.toHaveBeenCalled();
  });

  it("extraction insuffisante (nom seul, confiance faible) : insufficient_data, needsConfirmation=true, jamais de corroboration lancée", async () => {
    extractTcgCardFromPhoto.mockResolvedValueOnce({ extraction: weakExtraction, source: "ai", warnings: [], telemetry: {} });
    const result = await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-2", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-2/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );
    expect(result.status).toBe("insufficient_data");
    expect(result.result.needsConfirmation).toBe(true);
    expect(result.result.extractedFields.cardName).toBe("Pikachu");
    expect(orchestratePokemonPipeline).not.toHaveBeenCalled();
  });

  it("extraction suffisante + pipeline réussi : completed, identity et priceObservations mappés", async () => {
    extractTcgCardFromPhoto.mockResolvedValueOnce({ extraction: fullExtraction, source: "ai", warnings: [], telemetry: {} });
    orchestratePokemonPipeline.mockResolvedValueOnce({
      stage: "ready_for_intelligence_core",
      warnings: ["Identité corroborée par pokemon-tcg-api et tcgdex."],
      candidate: {
        catalogExternalId: "base1-58",
        catalogSources: ["pokemon-tcg-api", "tcgdex"],
        game: "pokemon",
        name: "Pikachu",
        setName: "Base Set",
        cardNumber: "58",
        variant: "Normal",
        language: "English",
        productKind: "raw_card",
        gradingCompany: null,
        grade: null,
        confidence: 1,
        catalogCorroboration: "corroborated",
        priceObservations: [
          {
            source: "justtcg",
            provenance: "justtcg-api-v2",
            amountCents: 768,
            currency: "USD",
            condition: "Near Mint",
            variant: "Normal",
            language: "English",
            gradingCompany: null,
            grade: null,
            region: "US",
            updatedAt: "2026-08-01T00:00:00.000Z",
            conversion: null,
            warnings: [],
          },
        ],
        provenance: ["pokemon-tcg-api", "tcgdex", "justtcg-api-v2"],
        warnings: [],
      },
    });

    const result = await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-3", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-3/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );

    expect(result.status).toBe("completed");
    expect(result.result.identity?.catalogExternalId).toBe("base1-58");
    expect(result.result.identity?.catalogCorroboration).toBe("corroborated");
    expect(result.result.priceObservations).toHaveLength(1);
    expect(result.result.priceObservations[0]!.amountCents).toBe(768);
  });

  it("pipeline refusé (cross_match_refused) : insufficient_data, aucune identité", async () => {
    extractTcgCardFromPhoto.mockResolvedValueOnce({ extraction: fullExtraction, source: "ai", warnings: [], telemetry: {} });
    orchestratePokemonPipeline.mockResolvedValueOnce({
      stage: "cross_match_refused",
      candidate: null,
      warnings: [],
      reason: "Aucune source de pricing n'a produit d'exact_match.",
    });

    const result = await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-4", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-4/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );

    expect(result.status).toBe("insufficient_data");
    expect(result.result.identity).toBeNull();
    expect(result.result.reason).toContain("exact_match");
  });

  it("providedTcgHints présent : saute l'extraction, lance directement la corroboration avec les valeurs corrigées", async () => {
    orchestratePokemonPipeline.mockResolvedValueOnce({
      stage: "ready_for_intelligence_core",
      warnings: [],
      candidate: {
        catalogExternalId: "base1-58",
        catalogSources: ["pokemon-tcg-api", "tcgdex"],
        game: "pokemon",
        name: "Pikachu",
        setName: "Base Set",
        cardNumber: "58",
        variant: null,
        language: "English",
        productKind: "raw_card",
        gradingCompany: null,
        grade: null,
        confidence: 1,
        catalogCorroboration: "corroborated",
        priceObservations: [],
        provenance: [],
        warnings: [],
      },
    });

    const result = await processTcgCardAnalysis(
      fakeDb(),
      {
        id: "req-5",
        imageReferences: [],
        providedTcgHints: {
          cardName: "Pikachu",
          setName: "Base Set",
          cardNumber: "58",
          variant: null,
          language: "English",
          productKind: "raw_card",
          gradingCompany: null,
          grade: null,
        },
      },
      { extractionOptions, connectors },
    );

    expect(extractTcgCardFromPhoto).not.toHaveBeenCalled();
    expect(orchestratePokemonPipeline).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("completed");
    expect(result.result.extractedFields.confidence).toBe(1);
  });

  it("connecteurs pricing non configurés (JUSTTCG_API_KEY absent) : failed, jamais un crash", async () => {
    extractTcgCardFromPhoto.mockResolvedValueOnce({ extraction: fullExtraction, source: "ai", warnings: [], telemetry: {} });
    const result = await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-6", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-6/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors: undefined },
    );
    expect(result.status).toBe("failed");
    expect(orchestratePokemonPipeline).not.toHaveBeenCalled();
  });

  it("extraction IA non configurée (pas de clé provider) : failed, jamais de tentative d'appel", async () => {
    const result = await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-7", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-7/photo.jpg" }], providedTcgHints: null },
      { extractionOptions: undefined, connectors },
    );
    expect(result.status).toBe("failed");
    expect(extractTcgCardFromPhoto).not.toHaveBeenCalled();
  });

  it("échec de génération d'URL signée (photo introuvable) : failed, jamais de crash", async () => {
    const result = await processTcgCardAnalysis(
      fakeDb(null),
      { id: "req-8", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-8/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );
    expect(result.status).toBe("failed");
    expect(extractTcgCardFromPhoto).not.toHaveBeenCalled();
  });

  it("référence d'image hors du stockage attendu : failed, jamais un chemin arbitraire utilisé", async () => {
    const result = await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-9", imageReferences: [{ url: "https://evil.example.test/not-our-bucket/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );
    expect(result.status).toBe("failed");
    expect(extractTcgCardFromPhoto).not.toHaveBeenCalled();
  });

  it("photo supprimée du stockage après traitement (y compris quand needsConfirmation)", async () => {
    extractTcgCardFromPhoto.mockResolvedValueOnce({ extraction: weakExtraction, source: "ai", warnings: [], telemetry: {} });
    const db = fakeDb();
    await processTcgCardAnalysis(
      db,
      { id: "req-10", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-10/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );
    expect((db.storage.from("analysis-uploads") as unknown as { remove: ReturnType<typeof vi.fn> }).remove).toHaveBeenCalledWith(["u1/req-10/photo.jpg"]);
  });

  it("photo supprimée du stockage MÊME quand le traitement échoue (extraction insuffisante puis pipeline indisponible)", async () => {
    const db = fakeDb();
    await processTcgCardAnalysis(
      db,
      { id: "req-11", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-11/photo.jpg" }], providedTcgHints: null },
      { extractionOptions: undefined, connectors },
    );
    expect((db.storage.from("analysis-uploads") as unknown as { remove: ReturnType<typeof vi.fn> }).remove).toHaveBeenCalledWith(["u1/req-11/photo.jpg"]);
  });

  it("échec provider (télémétrie status=error) : journalise provider/modèle/statut HTTP/code/message nettoyé, jamais un secret ni l'image", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    extractTcgCardFromPhoto.mockResolvedValueOnce({
      extraction: weakExtraction,
      source: "ai",
      warnings: ["PROVIDER_ERROR"],
      telemetry: {
        status: "error",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        errorCode: "UNAUTHORIZED",
        errorHttpStatus: 401,
        errorMessage: "Provider IA a répondu 401 (authentification).",
      },
    });

    await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-12", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-12/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisRequestId: "req-12",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        httpStatus: 401,
        errorCode: "UNAUTHORIZED",
        errorMessage: "Provider IA a répondu 401 (authentification).",
      }),
      expect.any(String),
    );
    const loggedPayload = JSON.stringify(warnSpy.mock.calls[0]);
    expect(loggedPayload).not.toMatch(/bearer|x-api-key|sk-ant|sk-proj|base64/i);
    warnSpy.mockRestore();
  });

  it("échec de validation schéma (INVALID_PROVIDER_RESPONSE) : journalise invalidPaths/invalidCodes/invalidIssues, jamais une valeur de champ extraite", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    extractTcgCardFromPhoto.mockResolvedValueOnce({
      extraction: weakExtraction,
      source: "ai",
      warnings: ["INVALID_PROVIDER_RESPONSE"],
      telemetry: {
        status: "error",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        errorCode: "INVALID_PROVIDER_RESPONSE",
        invalidPaths: ["cardName"],
        invalidCodes: ["invalid_type"],
        invalidIssues: [{ path: "cardName", code: "invalid_type", expected: "string", received: "object", message: "Expected string, received object" }],
      },
    });

    await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-14", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-14/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisRequestId: "req-14",
        errorCode: "INVALID_PROVIDER_RESPONSE",
        invalidPaths: ["cardName"],
        invalidCodes: ["invalid_type"],
      }),
      expect.any(String),
    );
    const loggedPayload = JSON.stringify(warnSpy.mock.calls[0]);
    expect(loggedPayload).not.toMatch(/bearer|x-api-key|sk-ant|sk-proj|base64/i);
    warnSpy.mockRestore();
  });

  it("extraction sans erreur (télémétrie status absent/success) : ne journalise jamais un échec provider inexistant", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    extractTcgCardFromPhoto.mockResolvedValueOnce({ extraction: fullExtraction, source: "ai", warnings: [], telemetry: { status: "success" } });
    orchestratePokemonPipeline.mockResolvedValueOnce({ stage: "cross_match_refused", candidate: null, warnings: [], reason: "test" });

    await processTcgCardAnalysis(
      fakeDb(),
      { id: "req-13", imageReferences: [{ url: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/req-13/photo.jpg" }], providedTcgHints: null },
      { extractionOptions, connectors },
    );

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
