import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import type { MarketSource } from "@dealradar/connectors";
import { deriveProductKey } from "@dealradar/core";

vi.mock("@dealradar/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dealradar/ingestion")>()),
  gatherActiveListingEvidence: vi.fn(),
  signStorageImageUrl: vi.fn(),
  orchestrateMarketIntelligence: vi.fn(),
}));

vi.mock("../../ingestion/market-source-factory", () => ({
  buildMarketSourcesFromEnv: vi.fn(() => ({ sources: [], diagnostics: [] })),
  computeEnvPresenceBySource: vi.fn(() => ({})),
}));

const { gatherActiveListingEvidence, signStorageImageUrl, orchestrateMarketIntelligence } = await import("@dealradar/ingestion");
const { buildMarketSourcesFromEnv, computeEnvPresenceBySource } = await import("../../ingestion/market-source-factory");
const { processAnalysis } = await import("../process-analysis");

/** Source de marché factice qui déclare supporter "lego" — sert uniquement à faire passer `resolveSourcesForCategory`, jamais réellement interrogée (orchestrateMarketIntelligence est mocké). */
function fakeMarketSource(name: string): MarketSource {
  return {
    source: name,
    displayName: name,
    supportedCategorySlugs: "any",
    evidenceTypes: ["historicalPrices"],
    async search() {
      return { observations: [] };
    },
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 1 };
    },
  };
}

const ANALYSIS_ID = "analysis-1";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ANALYSIS_ID,
    title: "LEGO 75313 très bon état",
    description: null,
    category_slug: "lego",
    purchase_price: 25,
    currency: "CHF",
    image_references: [],
    source_type: "manual_entry",
    ...overrides,
  };
}

const EBAY_ENV_KEYS = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_MARKETPLACE_ID", "EBAY_ENVIRONMENT"] as const;

beforeEach(() => {
  delete process.env.AI_PROVIDER;
  for (const key of EBAY_ENV_KEYS) delete process.env[key];
  vi.mocked(gatherActiveListingEvidence).mockReset();
  vi.mocked(signStorageImageUrl).mockReset();
  vi.mocked(orchestrateMarketIntelligence).mockReset();
  vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [], diagnostics: [] });
  vi.mocked(computeEnvPresenceBySource).mockReturnValue({});
});

afterEach(() => {
  for (const key of EBAY_ENV_KEYS) delete process.env[key];
});

describe("processAnalysis", () => {
  it("insufficient_data + CATEGORY_REQUIRED quand la catégorie n'est pas confirmée", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow({ category_slug: null })]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as { status: string; result: { warnings: string[] } };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.warnings).toContain("CATEGORY_REQUIRED");
  });

  it("insufficient_data + CONDITION_UNKNOWN quand l'état n'est pas détecté", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow({ title: "LEGO 75313" })]); // pas de mot-clé d'état

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: { warnings: string[]; product: { modelOrReference: string | null } };
    };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.warnings).toContain("CONDITION_UNKNOWN");
    // L'identification produit reste utile même sans état détecté.
    expect(row.result.product.modelOrReference).toBe("75313");
  });

  it("insufficient_data + PURCHASE_PRICE_REQUIRED quand le prix d'achat n'est pas confirmé", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow({ purchase_price: null })]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: { warnings: string[]; conditionEstimated: string | null };
    };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.warnings).toContain("PURCHASE_PRICE_REQUIRED");
    expect(row.result.conditionEstimated).toBe("very_good");
  });

  it("insufficient_data quand aucun comparable vendu ne correspond (identification correcte malgré tout)", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    // Aucune ligne dans `listings` : pool de comparables vide.

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: {
        decision: string;
        product: { name: string | null; modelOrReference: string | null };
        conditionEstimated: string | null;
        priceDetected: { amount: number; currency: string } | null;
        dataAvailability: { soldTransactions: boolean };
      };
    };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.decision).toBe("INSUFFICIENT_DATA");
    expect(row.result.product.modelOrReference).toBe("75313");
    expect(row.result.conditionEstimated).toBe("very_good");
    expect(row.result.priceDetected).toEqual({ amount: 25, currency: "CHF" });
    expect(row.result.dataAvailability.soldTransactions).toBe(false);
  });

  it("amorçage de cible de recherche (LOT Historical Data Engine, section 14) : une identification réussie persiste market_products/research_targets, INDÉPENDAMMENT du résultat INSUFFICIENT_DATA de l'estimation", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(db.table("market_products")).toHaveLength(1);
    expect(db.table("research_targets")).toHaveLength(1);
    const target = db.table("research_targets")[0] as { reason: string; desired_currency: string; enabled: boolean };
    expect(target.reason).toBe("user_scan");
    expect(target.desired_currency).toBe("CHF");
    expect(target.enabled).toBe(true);
  });

  it("panne d'écriture de la cible de recherche : isolée, jamais un échec de la requête d'analyse utilisateur", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    const originalFrom = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      if (table === "market_products" || table === "research_targets") throw new Error("panne d'écriture simulée");
      return originalFrom(table);
    });

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as { status: string };
    expect(row.status).toBe("insufficient_data"); // comportement identique à une analyse sans panne d'amorçage
  });

  it("utilise le pool de comparables vendus déjà persisté (dataAvailability.soldTransactions=true)", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    db.seed("listings", [
      {
        id: "sold-1",
        title: "LEGO 75313 vendu",
        price_cents: 3500,
        currency: "CHF",
        condition: "very_good",
        status: "sold",
        sold_at: new Date().toISOString(),
        attributes: { categorySlug: "lego", setNumber: "75313" },
        sources: { slug: "ebay" },
      },
      {
        id: "sold-2",
        title: "LEGO 75313 vendu 2",
        price_cents: 4000,
        currency: "CHF",
        condition: "very_good",
        status: "sold",
        sold_at: new Date().toISOString(),
        attributes: { categorySlug: "lego", setNumber: "75313" },
        sources: { slug: "ebay" },
      },
      {
        id: "sold-3",
        title: "LEGO 75313 vendu 3",
        price_cents: 3800,
        currency: "CHF",
        condition: "very_good",
        status: "sold",
        sold_at: new Date().toISOString(),
        attributes: { categorySlug: "lego", setNumber: "75313" },
        sources: { slug: "ebay" },
      },
    ]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: { dataAvailability: { soldTransactions: boolean }; marketValueEstimate: { provenance: string } | null };
    };
    expect(row.result.dataAvailability.soldTransactions).toBe(true);
    expect(row.result.marketValueEstimate?.provenance).toBe("sold_transaction");
  });

  it("sans eBay configuré, ne tente jamais l'appel de repli — jamais un blocage sur une intégration optionnelle absente", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    // EBAY_CLIENT_ID/SECRET/etc. volontairement absents (beforeEach).

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(gatherActiveListingEvidence).not.toHaveBeenCalled();
    const row = db.table("analysis_requests")[0] as { status: string };
    expect(row.status).toBe("insufficient_data"); // toujours pas de preuve, comportement inchangé
  });

  it("eBay configuré + aucune vente confirmée : utilise les annonces actives rassemblées comme repli, provenance honnête", async () => {
    process.env.EBAY_CLIENT_ID = "id";
    process.env.EBAY_CLIENT_SECRET = "secret";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_CH";
    process.env.EBAY_ENVIRONMENT = "sandbox";

    vi.mocked(gatherActiveListingEvidence).mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        id: `active-${i}`,
        sourceSlug: "ebay",
        title: "LEGO 75313 en vente",
        priceCents: 3600 + i * 10,
        currency: "CHF",
        condition: "very_good" as const,
        categorySlug: "lego",
        attributes: { setNumber: "75313" },
        soldAt: null,
      })),
    );

    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(gatherActiveListingEvidence).toHaveBeenCalledTimes(1);
    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: { decision: string; marketValueEstimate: { provenance: string } | null; dataAvailability: { soldTransactions: boolean } };
    };
    expect(row.status).not.toBe("insufficient_data");
    expect(row.result.marketValueEstimate?.provenance).toBe("active_listing");
    // La disponibilité de ventes confirmées reste honnêtement false — seules des annonces actives ont été utilisées.
    expect(row.result.dataAvailability.soldTransactions).toBe(false);
  });

  it("eBay configuré mais des ventes confirmées existent déjà en base : ne tente jamais l'appel de repli (jamais un mélange de preuves)", async () => {
    process.env.EBAY_CLIENT_ID = "id";
    process.env.EBAY_CLIENT_SECRET = "secret";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_CH";
    process.env.EBAY_ENVIRONMENT = "sandbox";

    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    db.seed("listings", [
      { id: "sold-1", title: "LEGO 75313 vendu", price_cents: 3500, currency: "CHF", condition: "very_good", status: "sold", sold_at: new Date().toISOString(), attributes: { categorySlug: "lego", setNumber: "75313" }, sources: { slug: "ebay" } },
      { id: "sold-2", title: "LEGO 75313 vendu 2", price_cents: 4000, currency: "CHF", condition: "very_good", status: "sold", sold_at: new Date().toISOString(), attributes: { categorySlug: "lego", setNumber: "75313" }, sources: { slug: "ebay" } },
      { id: "sold-3", title: "LEGO 75313 vendu 3", price_cents: 3800, currency: "CHF", condition: "very_good", status: "sold", sold_at: new Date().toISOString(), attributes: { categorySlug: "lego", setNumber: "75313" }, sources: { slug: "ebay" } },
    ]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(gatherActiveListingEvidence).not.toHaveBeenCalled();
  });

  it("une image fournie : tente de la signer avant extraction, jamais l'URL brute du bucket privé transmise telle quelle (bug réel corrigé ce lot)", async () => {
    vi.mocked(signStorageImageUrl).mockResolvedValue("https://signed.example/analysis-uploads/user/req/photo.jpg?token=abc");

    const db = new FakeSupabase();
    const rawUrl = "https://project.supabase.co/storage/v1/object/analysis-uploads/user-1/req-1/photo.jpg";
    db.seed("analysis_requests", [baseRow({ image_references: [{ url: rawUrl }] })]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(signStorageImageUrl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signStorageImageUrl).mock.calls[0]![1]).toBe(rawUrl);
  });

  it("la signature échoue pour toutes les images : elles sont omises, jamais un crash ni l'URL brute transmise en repli", async () => {
    vi.mocked(signStorageImageUrl).mockResolvedValue(null);

    const db = new FakeSupabase();
    db.seed("analysis_requests", [
      baseRow({ image_references: [{ url: "https://project.supabase.co/storage/v1/object/analysis-uploads/user-1/req-1/photo.jpg" }] }),
    ]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as { status: string };
    // Aucune image exploitable -> l'extraction se comporte comme sans image, jamais une exception qui remonte.
    expect(row.status).toBe("insufficient_data");
  });

  it("aucune source de marché disponible (aucune credential) : jamais d'appel à orchestrateMarketIntelligence", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(orchestrateMarketIntelligence).not.toHaveBeenCalled();
  });

  it("sources multi-source disponibles + fusion estimée : utilise la valorisation fusionnée, marketEvidence rempli, decision cohérente", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] });
    vi.mocked(computeEnvPresenceBySource).mockReturnValue({ bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true } });
    vi.mocked(orchestrateMarketIntelligence).mockResolvedValue({
      sourceDiagnostics: [{ source: "bricklink", status: "success", observationCount: 3, latencyMs: 10 }],
      observationCount: 3,
      liveObservationCount: 0,
      historicalObservationCount: 3,
      sourceNames: ["bricklink"],
      directSourceCount: 1,
      aggregatorSourceCount: 0,
      evidenceTypeMix: [{ evidenceType: "historicalPrices", count: 3 }],
      costClassesUsed: ["free"],
      fx: { observedCurrencies: ["CHF"], ratesUsed: [], skippedForMissingRateCount: 0 },
      skippedForCurrencyCount: 0,
      persistedCount: 3,
      persistenceError: null,
      fxRatesPersistedCount: null,
      fxPersistenceError: null,
      coverageReport: {
        categorySlug: "lego",
        asOf: "2026-09-21T00:00:00.000Z",
        sourcesQueried: 1,
        sourcesSucceeded: 1,
        sourcesFailed: 0,
        perSource: [{ source: "bricklink", status: "success", observationCount: 3, latencyMs: 10, costClass: "free" }],
        observationsReturned: 3,
        observationsAfterCanonicalDedupe: 3,
        observationsUsableAfterFx: 3,
        observationsPersisted: 3,
        medianLatencyMs: 10,
      },
      fused: {
        status: "estimated",
        lowCents: 17000,
        fairCents: 18000,
        highCents: 19000,
        currency: "CHF",
        confidence: 80,
        evidenceCount: 3,
        sourceCount: 1,
        strongestTier: "B",
        evidenceMix: [{ tier: "B", source: "bricklink", merchant: "bricklink", count: 3 }],
        freshnessHours: 2,
        reasons: ["3 observation(s) retenue(s), palier le plus fort : B."],
        insufficiencyReason: null,
        confidenceComponents: null,
        qualityFlags: ["specialist_only"],
        historicalReferenceMedianCents: null,
        trendDescriptor: null,
        trendConfidence: null,
        historyStabilizationApplied: false,
      },
    });

    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(orchestrateMarketIntelligence).toHaveBeenCalledTimes(1);
    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: {
        decision: string;
        marketValueEstimate: { amount: number; currency: string; provenance: string } | null;
        marketEvidence?: {
          strongestTier: string | null;
          sourceCount: number;
          usedSpecialistHistory: boolean;
          retailOnlyWarning: boolean;
          qualityFlags?: string[];
          trendDescriptor?: string | null;
          historicalReferenceMedianCents?: number | null;
        };
        dataAvailability: { soldTransactions: boolean; marketGuide: boolean };
      };
    };
    expect(row.status).not.toBe("insufficient_data");
    expect(row.result.marketValueEstimate).toEqual({ amount: 180, currency: "CHF", provenance: "market_guide" });
    expect(row.result.marketEvidence?.strongestTier).toBe("B");
    expect(row.result.marketEvidence?.usedSpecialistHistory).toBe(true);
    expect(row.result.marketEvidence?.retailOnlyWarning).toBe(false);
    // LOT "Data Quality Calibration...", section 10 — la fusion transmet ses
    // signaux de qualité/historique tels quels dans `marketEvidence`, jamais
    // recalculés côté worker.
    expect(row.result.marketEvidence?.qualityFlags).toEqual(["specialist_only"]);
    expect(row.result.marketEvidence?.trendDescriptor).toBeNull();
    expect(row.result.marketEvidence?.historicalReferenceMedianCents).toBeNull();
    expect(row.result.dataAvailability.soldTransactions).toBe(false); // palier B, jamais présenté comme une vente confirmée
    expect(row.result.dataAvailability.marketGuide).toBe(true);
  });

  it("historique persisté disponible pour productKey : contexte d'historique construit et transmis à orchestrateMarketIntelligence (LOT Interactive History..., section 1)", async () => {
    const productKey = deriveProductKey("lego", { brand: "LEGO" });
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] });
    vi.mocked(computeEnvPresenceBySource).mockReturnValue({ bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true } });
    vi.mocked(orchestrateMarketIntelligence).mockResolvedValue({
      sourceDiagnostics: [{ source: "bricklink", status: "success", observationCount: 3, latencyMs: 10 }],
      observationCount: 3,
      liveObservationCount: 0,
      historicalObservationCount: 3,
      sourceNames: ["bricklink"],
      directSourceCount: 1,
      aggregatorSourceCount: 0,
      evidenceTypeMix: [{ evidenceType: "historicalPrices", count: 3 }],
      costClassesUsed: ["free"],
      fx: { observedCurrencies: ["CHF"], ratesUsed: [], skippedForMissingRateCount: 0 },
      skippedForCurrencyCount: 0,
      persistedCount: 3,
      persistenceError: null,
      fxRatesPersistedCount: null,
      fxPersistenceError: null,
      coverageReport: {
        categorySlug: "lego",
        asOf: "2026-09-21T00:00:00.000Z",
        sourcesQueried: 1,
        sourcesSucceeded: 1,
        sourcesFailed: 0,
        perSource: [{ source: "bricklink", status: "success", observationCount: 3, latencyMs: 10, costClass: "free" }],
        observationsReturned: 3,
        observationsAfterCanonicalDedupe: 3,
        observationsUsableAfterFx: 3,
        observationsPersisted: 3,
        medianLatencyMs: 10,
      },
      fused: {
        status: "estimated",
        lowCents: 17000,
        fairCents: 18000,
        highCents: 19000,
        currency: "CHF",
        confidence: 80,
        evidenceCount: 3,
        sourceCount: 1,
        strongestTier: "B",
        evidenceMix: [{ tier: "B", source: "bricklink", merchant: "bricklink", count: 3 }],
        freshnessHours: 2,
        reasons: ["3 observation(s) retenue(s), palier le plus fort : B."],
        insufficiencyReason: null,
        confidenceComponents: null,
        qualityFlags: [],
        historicalReferenceMedianCents: 18000,
        trendDescriptor: "flat",
        trendConfidence: 40,
        historyStabilizationApplied: false,
      },
    });

    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    db.seed("market_observations", [
      { product_key: productKey, observed_at: "2026-09-01T00:00:00.000Z", price_cents: 18000, source: "bricklink" },
      { product_key: productKey, observed_at: "2026-09-10T00:00:00.000Z", price_cents: 18500, source: "bricklink" },
    ]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(orchestrateMarketIntelligence).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(orchestrateMarketIntelligence).mock.calls[0]![0] as { history?: { sampleSize: number; historicalMedianCents: number | null } };
    expect(callArgs.history).toBeDefined();
    expect(callArgs.history?.sampleSize).toBe(2);
    expect(callArgs.history?.historicalMedianCents).not.toBeNull();

    // Le `marketEvidence` écrit reflète ce que la fusion (mockée ici) a
    // renvoyé — jamais recalculé côté worker (voir le test précédent).
    const row = db.table("analysis_requests")[0] as { result: { marketEvidence?: { historicalReferenceMedianCents: number | null; trendDescriptor: string | null } } };
    expect(row.result.marketEvidence?.historicalReferenceMedianCents).toBe(18000);
    expect(row.result.marketEvidence?.trendDescriptor).toBe("flat");
  });

  it("aucun historique persisté pour productKey : orchestrateMarketIntelligence appelé SANS `history` — comportement identique à avant ce lot", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] });
    vi.mocked(computeEnvPresenceBySource).mockReturnValue({ bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true } });
    vi.mocked(orchestrateMarketIntelligence).mockRejectedValue(new Error("non pertinent pour ce test"));

    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    // Aucune ligne dans `market_observations` : historique vide.

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    expect(orchestrateMarketIntelligence).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(orchestrateMarketIntelligence).mock.calls[0]![0] as { history?: unknown };
    expect(callArgs.history).toBeUndefined();
  });

  it("fusion multi-source insuffisante (aucune preuve exploitable trouvée) : reste INSUFFICIENT_DATA, marketEvidence reflète honnêtement l'absence de preuve", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] });
    vi.mocked(computeEnvPresenceBySource).mockReturnValue({ bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true } });
    vi.mocked(orchestrateMarketIntelligence).mockResolvedValue({
      sourceDiagnostics: [{ source: "bricklink", status: "success", observationCount: 0, latencyMs: 10 }],
      observationCount: 0,
      liveObservationCount: 0,
      historicalObservationCount: 0,
      sourceNames: [],
      directSourceCount: 0,
      aggregatorSourceCount: 0,
      evidenceTypeMix: [],
      costClassesUsed: ["free"],
      fx: { observedCurrencies: [], ratesUsed: [], skippedForMissingRateCount: 0 },
      skippedForCurrencyCount: 0,
      persistedCount: 0,
      persistenceError: null,
      fxRatesPersistedCount: null,
      fxPersistenceError: null,
      coverageReport: {
        categorySlug: "lego",
        asOf: "2026-09-21T00:00:00.000Z",
        sourcesQueried: 1,
        sourcesSucceeded: 1,
        sourcesFailed: 0,
        perSource: [{ source: "bricklink", status: "success", observationCount: 0, latencyMs: 10, costClass: "free" }],
        observationsReturned: 0,
        observationsAfterCanonicalDedupe: 0,
        observationsUsableAfterFx: 0,
        observationsPersisted: 0,
        medianLatencyMs: 10,
      },
      fused: {
        status: "insufficient",
        lowCents: null,
        fairCents: null,
        highCents: null,
        currency: "CHF",
        confidence: 0,
        evidenceCount: 0,
        sourceCount: 0,
        strongestTier: null,
        evidenceMix: [],
        freshnessHours: null,
        reasons: [],
        insufficiencyReason: "NO_OBSERVATIONS",
        confidenceComponents: null,
        qualityFlags: [],
        historicalReferenceMedianCents: null,
        trendDescriptor: null,
        trendConfidence: null,
        historyStabilizationApplied: false,
      },
    });

    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as { status: string; result: { decision: string; marketEvidence?: { strongestTier: string | null } } };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.decision).toBe("INSUFFICIENT_DATA");
    expect(row.result.marketEvidence?.strongestTier).toBeNull();
  });

  it("panne de l'intelligence de marché multi-source (exception) : le résultat existant est conservé, jamais un crash", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] });
    vi.mocked(computeEnvPresenceBySource).mockReturnValue({ bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true } });
    vi.mocked(orchestrateMarketIntelligence).mockRejectedValue(new Error("panne réseau simulée"));

    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as { status: string; result: { decision: string } };
    expect(row.status).toBe("insufficient_data"); // comportement identique à l'absence totale d'enrichissement
    expect(row.result.decision).toBe("INSUFFICIENT_DATA");
  });

  describe("santé par source (LOT 'Product History UX + Source Health + Interactive Cancellation + Beta Readiness', section 4)", () => {
    it("un appel réussi persiste/incrémente source_health_state pour la source interrogée", async () => {
      vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] });
      vi.mocked(computeEnvPresenceBySource).mockReturnValue({ bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true } });
      vi.mocked(orchestrateMarketIntelligence).mockResolvedValue({
        sourceDiagnostics: [{ source: "bricklink", status: "success", observationCount: 3, latencyMs: 10 }],
        observationCount: 3,
        liveObservationCount: 0,
        historicalObservationCount: 3,
        sourceNames: ["bricklink"],
        directSourceCount: 1,
        aggregatorSourceCount: 0,
        evidenceTypeMix: [{ evidenceType: "historicalPrices", count: 3 }],
        costClassesUsed: ["free"],
        fx: { observedCurrencies: ["CHF"], ratesUsed: [], skippedForMissingRateCount: 0 },
        skippedForCurrencyCount: 0,
        persistedCount: 3,
        persistenceError: null,
        fxRatesPersistedCount: null,
        fxPersistenceError: null,
        coverageReport: {
          categorySlug: "lego",
          asOf: "2026-09-21T00:00:00.000Z",
          sourcesQueried: 1,
          sourcesSucceeded: 1,
          sourcesFailed: 0,
          perSource: [{ source: "bricklink", status: "success", observationCount: 3, latencyMs: 10, costClass: "free" }],
          observationsReturned: 3,
          observationsAfterCanonicalDedupe: 3,
          observationsUsableAfterFx: 3,
          observationsPersisted: 3,
          medianLatencyMs: 10,
        },
        fused: {
          status: "estimated",
          lowCents: 17000,
          fairCents: 18000,
          highCents: 19000,
          currency: "CHF",
          confidence: 80,
          evidenceCount: 3,
          sourceCount: 1,
          strongestTier: "B",
          evidenceMix: [{ tier: "B", source: "bricklink", merchant: "bricklink", count: 3 }],
          freshnessHours: 2,
          reasons: ["3 observation(s) retenue(s), palier le plus fort : B."],
          insufficiencyReason: null,
          confidenceComponents: null,
          qualityFlags: [],
          historicalReferenceMedianCents: null,
          trendDescriptor: null,
          trendConfidence: null,
          historyStabilizationApplied: false,
        },
      });

      const db = new FakeSupabase();
      db.seed("analysis_requests", [baseRow()]);

      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

      const rows = db.table("source_health_state") as { source: string; requests_used: number; observations_returned_total: number }[];
      expect(rows.some((r) => r.source === "bricklink" && r.requests_used === 1 && r.observations_returned_total === 3)).toBe(true);
    });
  });

  describe("annulation interactive (LOT 'Product History UX + Source Health + Interactive Cancellation + Beta Readiness', section 6/7)", () => {
    it("cancel_requested_at posé AVANT tout traitement : status='cancelled', result=null, aucun amorçage de cible ni appel marché", async () => {
      const db = new FakeSupabase();
      db.seed("analysis_requests", [baseRow({ cancel_requested_at: "2026-09-21T00:00:00.000Z" })]);

      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

      const row = db.table("analysis_requests")[0] as { status: string; result: unknown };
      expect(row.status).toBe("cancelled");
      expect(row.result).toBeNull();
      // Jamais une panne fournisseur : aucun appel réseau/marché déclenché.
      expect(orchestrateMarketIntelligence).not.toHaveBeenCalled();
      // Sortie AVANT l'amorçage de cible (qui a lieu plus loin dans le
      // chemin générique) — jamais une cible amorcée pour un cycle annulé
      // dès le départ.
      expect(db.table("research_targets")).toHaveLength(0);
      expect(db.table("market_products")).toHaveLength(0);
    });

    it("annulation demandée PENDANT le traitement (avant l'étape marché) : relecture fraîche détecte l'annulation, jamais d'appel à orchestrateMarketIntelligence ni de mise à jour de santé par source", async () => {
      vi.mocked(buildMarketSourcesFromEnv).mockImplementation(() => {
        // Simule une annulation demandée par l'utilisateur PENDANT
        // l'extraction/le pré-traitement — la ligne `analysis_requests` est
        // mutée directement ici, exactement comme le ferait la RPC
        // `request_analysis_cancellation` côté Postgres pendant que ce
        // cycle tourne déjà. Le contrôle initial (capturé plus tôt dans
        // `processAnalysis`) est donc déjà passé — seule une RELECTURE
        // fraîche (`isCancellationRequested`) peut la détecter.
        const row = db.table("analysis_requests")[0] as { cancel_requested_at: string | null };
        row.cancel_requested_at = "2026-09-21T00:05:00.000Z";
        return { sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] };
      });
      vi.mocked(computeEnvPresenceBySource).mockReturnValue({ bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true } });

      const db = new FakeSupabase();
      db.seed("analysis_requests", [baseRow()]);

      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

      const row = db.table("analysis_requests")[0] as { status: string; result: unknown };
      expect(row.status).toBe("cancelled");
      expect(row.result).toBeNull();
      expect(orchestrateMarketIntelligence).not.toHaveBeenCalled();
      // Aucune mise à jour de santé par source pour ce cycle annulé — la
      // lecture initiale de santé (isolée, en amont) n'écrit jamais, et la
      // seule écriture possible (`persistSourceHealthState`) est
      // conditionnée à un `marketIntelligence` non-null, jamais atteint ici.
      expect(db.table("source_health_state")).toHaveLength(0);
    });
  });

  describe("résolution de productKey (LOT Interactive History + Generic Result UI + Full Cancellation + Pre-Prod Activation Package, section 2)", () => {
    it("même capacité extraite deux fois : le même product_key est persisté sur research_targets", async () => {
      const db1 = new FakeSupabase();
      db1.seed("analysis_requests", [baseRow({ category_slug: "apple", title: "Apple iPhone 15 Pro 128GB très bon état" })]);
      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db1 as never);
      const key1 = (db1.table("research_targets")[0] as { product_key: string } | undefined)?.product_key;

      const db2 = new FakeSupabase();
      db2.seed("analysis_requests", [baseRow({ category_slug: "apple", title: "Apple iPhone 15 Pro 128GB très bon état, boîte incluse" })]);
      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db2 as never);
      const key2 = (db2.table("research_targets")[0] as { product_key: string } | undefined)?.product_key;

      expect(key1).toBeDefined();
      expect(key1).toBe(key2);
    });

    it("capacité différente (128GB vs 256GB) : product_key distinct — corrige un bug latent qui aurait fusionné leur historique", async () => {
      const db128 = new FakeSupabase();
      db128.seed("analysis_requests", [baseRow({ category_slug: "apple", title: "Apple iPhone 15 Pro 128GB très bon état" })]);
      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db128 as never);
      const key128 = (db128.table("research_targets")[0] as { product_key: string } | undefined)?.product_key;

      const db256 = new FakeSupabase();
      db256.seed("analysis_requests", [baseRow({ category_slug: "apple", title: "Apple iPhone 15 Pro 256GB très bon état" })]);
      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db256 as never);
      const key256 = (db256.table("research_targets")[0] as { product_key: string } | undefined)?.product_key;

      expect(key128).toBeDefined();
      expect(key256).toBeDefined();
      expect(key128).not.toBe(key256);
    });

    it("changement d'état (condition) seul, même capacité : product_key inchangé — l'état reste une preuve, jamais un composant d'identité", async () => {
      const dbGood = new FakeSupabase();
      dbGood.seed("analysis_requests", [baseRow({ category_slug: "apple", title: "Apple iPhone 15 Pro 128GB très bon état" })]);
      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, dbGood as never);
      const keyGood = (dbGood.table("research_targets")[0] as { product_key: string } | undefined)?.product_key;

      const dbFair = new FakeSupabase();
      dbFair.seed("analysis_requests", [baseRow({ category_slug: "apple", title: "Apple iPhone 15 Pro 128GB état correct" })]);
      await processAnalysis({ analysisRequestId: ANALYSIS_ID }, dbFair as never);
      const keyFair = (dbFair.table("research_targets")[0] as { product_key: string } | undefined)?.product_key;

      expect(keyGood).toBeDefined();
      expect(keyGood).toBe(keyFair);
    });
  });
});
