import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import type { MarketSource } from "@dealradar/connectors";

vi.mock("@dealradar/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dealradar/ingestion")>()),
  gatherActiveListingEvidence: vi.fn(),
  signStorageImageUrl: vi.fn(),
  orchestrateMarketIntelligence: vi.fn(),
}));

vi.mock("../../ingestion/market-source-factory", () => ({
  buildMarketSourcesFromEnv: vi.fn(() => ({ sources: [], diagnostics: [] })),
}));

const { gatherActiveListingEvidence, signStorageImageUrl, orchestrateMarketIntelligence } = await import("@dealradar/ingestion");
const { buildMarketSourcesFromEnv } = await import("../../ingestion/market-source-factory");
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
    vi.mocked(orchestrateMarketIntelligence).mockResolvedValue({
      sourceDiagnostics: [{ source: "bricklink", status: "success", observationCount: 3, latencyMs: 10 }],
      observationCount: 3,
      liveObservationCount: 0,
      historicalObservationCount: 3,
      sourceNames: ["bricklink"],
      skippedForCurrencyCount: 0,
      persistedCount: 3,
      persistenceError: null,
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
        marketEvidence?: { strongestTier: string | null; sourceCount: number; usedSpecialistHistory: boolean; retailOnlyWarning: boolean };
        dataAvailability: { soldTransactions: boolean; marketGuide: boolean };
      };
    };
    expect(row.status).not.toBe("insufficient_data");
    expect(row.result.marketValueEstimate).toEqual({ amount: 180, currency: "CHF", provenance: "market_guide" });
    expect(row.result.marketEvidence?.strongestTier).toBe("B");
    expect(row.result.marketEvidence?.usedSpecialistHistory).toBe(true);
    expect(row.result.marketEvidence?.retailOnlyWarning).toBe(false);
    expect(row.result.dataAvailability.soldTransactions).toBe(false); // palier B, jamais présenté comme une vente confirmée
    expect(row.result.dataAvailability.marketGuide).toBe(true);
  });

  it("fusion multi-source insuffisante (aucune preuve exploitable trouvée) : reste INSUFFICIENT_DATA, marketEvidence reflète honnêtement l'absence de preuve", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] });
    vi.mocked(orchestrateMarketIntelligence).mockResolvedValue({
      sourceDiagnostics: [{ source: "bricklink", status: "success", observationCount: 0, latencyMs: 10 }],
      observationCount: 0,
      liveObservationCount: 0,
      historicalObservationCount: 0,
      sourceNames: [],
      skippedForCurrencyCount: 0,
      persistedCount: 0,
      persistenceError: null,
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
    vi.mocked(orchestrateMarketIntelligence).mockRejectedValue(new Error("panne réseau simulée"));

    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as { status: string; result: { decision: string } };
    expect(row.status).toBe("insufficient_data"); // comportement identique à l'absence totale d'enrichissement
    expect(row.result.decision).toBe("INSUFFICIENT_DATA");
  });
});
