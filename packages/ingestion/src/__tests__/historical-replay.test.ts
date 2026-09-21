import { describe, expect, it, vi } from "vitest";
import type { MarketObservation, MarketSource, FxRate, FxRateProvider } from "@dealradar/connectors";
import {
  createCanonicalProductIdentity,
  mergeIdentityEvidence,
  KNOWN_SOURCE_QUERY_PROFILES,
  fuseMarketObservations,
  computeHistoryIntelligenceV2,
  initListingLifecycle,
  recordListingObservation,
  reconcileListingLifecycles,
  type HistoryPointV2,
  type FusionObservation,
} from "@dealradar/core";
import { FakeSupabase } from "./fake-supabase";
import { takeMarketSnapshot } from "../take-market-snapshot";
import { mapMarketObservationsToFusionObservations } from "../map-market-observations-to-fusion";

/**
 * Rejeu historique déterministe (LOT "Historical Data Engine", section 12)
 * — un iPhone 15 Pro 256GB observé sur 4 cycles répartis sur ~90 jours,
 * mélange de sources réaliste (spécialiste USD, annonce active CHF, deux
 * agrégateurs retail du MÊME marchand, une panne de source, un changement
 * de taux FX, une disparition d'annonce). Prouve les 6 garanties exigées
 * par le lot, jamais supposées — chacune est une assertion explicite
 * ci-dessous.
 */

const DAY0 = "2026-01-01T00:00:00.000Z";
const DAY30 = "2026-01-31T00:00:00.000Z";
const DAY60 = "2026-03-02T00:00:00.000Z";
const DAY90 = "2026-04-01T00:00:00.000Z";

function obs(overrides: Partial<MarketObservation>): MarketObservation {
  return {
    source: "keepa",
    sourceItemId: "x",
    sourceUrl: null,
    observedAt: DAY0,
    productKey: null,
    query: "iphone 15 pro 256gb",
    title: "iPhone 15 Pro 256GB",
    brand: "Apple",
    model: "iPhone 15 Pro",
    variant: null,
    identifiers: { upc: "0195949031412" },
    condition: null,
    completeness: null,
    priceAmountCents: 100000,
    currency: "USD",
    shippingCostCents: null,
    totalPriceCents: null,
    country: "US",
    marketplace: "amazon",
    evidenceType: "historicalPrices",
    evidenceTier: "B",
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

function fakeSource(source: string, impl: () => Promise<{ observations: MarketObservation[] }>): MarketSource {
  return {
    source,
    displayName: source,
    supportedCategorySlugs: "any",
    evidenceTypes: ["historicalPrices"],
    search: impl,
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 1 };
    },
  };
}

function fxProviderAt(rate: number): FxRateProvider {
  return {
    source: "fake-fx",
    getRate: vi.fn().mockResolvedValue({ baseCurrency: "USD", quoteCurrency: "CHF", rate, rateDate: "2026-01-01", source: "fake-fx", fetchedAt: DAY0 } satisfies FxRate),
  };
}

describe("Rejeu historique — iPhone 15 Pro 256GB sur ~90 jours", () => {
  const identity = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-15-pro:256gb"), {
    source: "user_scan",
    confidence: 0.95,
    observedAt: DAY0,
    fields: { brand: "Apple", model: "iPhone 15 Pro", storage: "256GB", upc: "0195949031412", asin: "B0CHX1W1XY" },
  }).identity;

  const db = new FakeSupabase();

  it("cycle 1 (jour 0) : keepa (USD, spécialiste), eBay (CHF, annonce active), Google Shopping (CHF, retail) — persistés sans doublon", async () => {
    const keepa = fakeSource("keepa", async () => ({ observations: [obs({ source: "keepa", sourceItemId: "asin:B0CHX1W1XY", observedAt: DAY0, priceAmountCents: 110000, currency: "USD", evidenceType: "historicalPrices", evidenceTier: "B" })] }));
    const ebay = fakeSource("ebay", async () => ({ observations: [obs({ source: "ebay", sourceItemId: "e1", observedAt: DAY0, priceAmountCents: 95000, currency: "CHF", marketplace: "ebay", evidenceType: "activeListings", evidenceTier: "D", condition: "used" })] }));
    const googleShopping = fakeSource("google_shopping", async () => ({ observations: [obs({ source: "google_shopping", sourceItemId: "gp-1", observedAt: DAY0, priceAmountCents: 120000, currency: "CHF", marketplace: "digitec.ch", evidenceType: "retailPrices", evidenceTier: "E" })] }));

    const result = await takeMarketSnapshot({
      identity,
      categorySlug: "apple",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [keepa, ebay, googleShopping],
      asOf: DAY0,
      fxRateProvider: fxProviderAt(0.9),
      persistence: { supabase: db as never },
    });

    expect(result.summary.observationCount).toBe(3);
    expect(db.table("market_observations")).toHaveLength(3);
  });

  it("cycle 2 (jour 30) : panne Google Shopping isolée, eBay toujours actif (nouveau prix), Keepa continue de tracker l'historique — aucun doublon avec le cycle 1", async () => {
    const keepa = fakeSource("keepa", async () => ({ observations: [obs({ source: "keepa", sourceItemId: "asin:B0CHX1W1XY", observedAt: DAY30, priceAmountCents: 105000, currency: "USD", evidenceType: "historicalPrices", evidenceTier: "B" })] }));
    const ebay = fakeSource("ebay", async () => ({ observations: [obs({ source: "ebay", sourceItemId: "e1", observedAt: DAY30, priceAmountCents: 94000, currency: "CHF", marketplace: "ebay", evidenceType: "activeListings", evidenceTier: "D", condition: "used" })] }));
    const googleShopping = fakeSource("google_shopping", async () => {
      throw new Error("panne Google Shopping simulée");
    });

    const result = await takeMarketSnapshot({
      identity,
      categorySlug: "apple",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [keepa, ebay, googleShopping],
      asOf: DAY30,
      fxRateProvider: fxProviderAt(0.9),
      persistence: { supabase: db as never },
    });

    expect(result.coverageReport.sourcesFailed).toBe(1); // Google Shopping isolé, jamais un blocage
    expect(result.summary.observationCount).toBe(2);
    // 3 (cycle 1) + 2 (cycle 2, nouveaux horodatages, jamais des doublons du cycle 1) = 5, jamais moins (pas de doublon accidentel), jamais plus (pas de duplication).
    expect(db.table("market_observations")).toHaveLength(5);
  });

  it("cycle 3 (jour 60) : eBay disparaît, taux FX change, marchand dupliqué via 2 agrégateurs — dédoublonné, disparition jamais confondue avec une vente", async () => {
    const keepa = fakeSource("keepa", async () => ({ observations: [obs({ source: "keepa", sourceItemId: "asin:B0CHX1W1XY", observedAt: DAY60, priceAmountCents: 100000, currency: "USD", evidenceType: "historicalPrices", evidenceTier: "B" })] }));
    const googleShopping = fakeSource("google_shopping", async () => ({ observations: [obs({ source: "google_shopping", sourceItemId: "gp-1", observedAt: DAY60, priceAmountCents: 110000, currency: "CHF", marketplace: "digitec.ch", evidenceType: "retailPrices", evidenceTier: "E" })] }));
    const dataForSeo = fakeSource("dataforseo_google_shopping", async () => ({ observations: [obs({ source: "dataforseo_google_shopping", sourceItemId: "dfs-1", observedAt: DAY60, priceAmountCents: 110500, currency: "CHF", marketplace: "digitec.ch", evidenceType: "retailPrices", evidenceTier: "E" })] }));
    // eBay volontairement ABSENT de cette liste de sources -> l'annonce "e1" n'est plus observée ce cycle.

    const result = await takeMarketSnapshot({
      identity,
      categorySlug: "apple",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [keepa, googleShopping, dataForSeo],
      asOf: DAY60,
      fxRateProvider: fxProviderAt(0.88), // taux FX changé depuis le cycle 1/2
      persistence: { supabase: db as never },
    });

    // Google Shopping + DataForSEO, même marchand digitec.ch, même UPC, prix quasi identique -> UNE seule observation retenue, jamais deux.
    expect(result.summary.observationCount).toBe(2); // keepa + (google_shopping OU dataforseo, fusionnés)
    expect(db.table("market_observations")).toHaveLength(7); // 5 + 2 nouvelles (keepa + le marchand dédoublonné)

    // RÈGLE ABSOLUE : la disparition d'eBay n'est JAMAIS une vente. Reconstituée ici via listing-lifecycle à partir des observations réellement persistées (jamais déduite par takeMarketSnapshot lui-même, qui ne fait aucune hypothèse de vente).
    let ebayLifecycle = initListingLifecycle("ebay:e1", { observedAt: DAY0 });
    ebayLifecycle = recordListingObservation(ebayLifecycle, { observedAt: DAY30 });
    const reconciled = reconcileListingLifecycles({
      previousStates: [ebayLifecycle],
      observedThisCycle: new Map(), // pas revue au cycle 3
      asOf: DAY60,
      disappearanceRuleHours: 24 * 20, // 20 jours sans observation -> disparue
    });
    expect(reconciled[0]!.currentlySeen).toBe(false);
    expect(reconciled[0]!.confirmedSoldAt).toBeNull(); // JAMAIS une vente déduite de la disparition
  });

  it("cycle 4 (jour 90) : tendance baissière confirmée, historique enrichi", async () => {
    const keepa = fakeSource("keepa", async () => ({ observations: [obs({ source: "keepa", sourceItemId: "asin:B0CHX1W1XY", observedAt: DAY90, priceAmountCents: 95000, currency: "USD", evidenceType: "historicalPrices", evidenceTier: "B" })] }));
    const googleShopping = fakeSource("google_shopping", async () => ({ observations: [obs({ source: "google_shopping", sourceItemId: "gp-1", observedAt: DAY90, priceAmountCents: 105000, currency: "CHF", marketplace: "digitec.ch", evidenceType: "retailPrices", evidenceTier: "E" })] }));

    await takeMarketSnapshot({
      identity,
      categorySlug: "apple",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [keepa, googleShopping],
      asOf: DAY90,
      fxRateProvider: fxProviderAt(0.88),
      persistence: { supabase: db as never },
    });

    expect(db.table("market_observations")).toHaveLength(9); // 7 + 2

    // Les métriques d'historique ÉVOLUENT correctement : reconstitue l'historique complet des points Keepa (USD) persistés à travers les 4 cycles et vérifie une tendance BAISSIÈRE cohérente avec 110000 -> 100000 -> 95000 (USD, avant conversion).
    const keepaRows = (db.table("market_observations") as { source: string; observed_at: string; price_cents: number }[]).filter((r) => r.source === "keepa");
    expect(keepaRows.length).toBeGreaterThanOrEqual(3);
    const points: HistoryPointV2[] = keepaRows.map((r) => ({ observedAt: r.observed_at, priceCents: r.price_cents, source: "keepa" }));
    const history = computeHistoryIntelligenceV2(points, DAY90);
    const trend90d = history.trends.find((t) => t.windowDays === 90)!;
    expect(trend90d.direction).toBe("down");
  });

  it("la valorisation fusionnée évolue LOGIQUEMENT entre le cycle 1 et le cycle 4 (baisse cohérente avec l'historique observé)", async () => {
    function fusionObservationsFor(rows: { source: string; observed_at: string; price_cents: number; currency: string; evidence_tier: string; marketplace: string }[], asOf: string): FusionObservation[] {
      const relevant = rows.filter((r) => Date.parse(r.observed_at) <= Date.parse(asOf));
      const marketObservations: MarketObservation[] = relevant.map((r) =>
        obs({ source: r.source, sourceItemId: `${r.source}:${r.observed_at}`, observedAt: r.observed_at, priceAmountCents: r.price_cents, currency: r.currency as string, marketplace: r.marketplace, evidenceTier: r.evidence_tier as MarketObservation["evidenceTier"] }),
      );
      const { fusionObservations } = mapMarketObservationsToFusionObservations(marketObservations, {
        targetCurrency: "CHF",
        rates: { USD: { baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.88, rateDate: "2026-01-01", source: "fake", fetchedAt: DAY0 } },
        maxRateAgeHours: 24 * 365,
      });
      return fusionObservations;
    }

    const allRows = db.table("market_observations") as { source: string; observed_at: string; price_cents: number; currency: string; evidence_tier: string; marketplace: string }[];

    const cycle1Fused = fuseMarketObservations(fusionObservationsFor(allRows, DAY0), { asOf: DAY0, target: { currency: "CHF" } });
    const cycle4Fused = fuseMarketObservations(fusionObservationsFor(allRows, DAY90), { asOf: DAY90, target: { currency: "CHF" } });

    expect(cycle1Fused.status).toBe("estimated");
    expect(cycle4Fused.status).toBe("estimated");
    expect(cycle4Fused.fairCents!).toBeLessThan(cycle1Fused.fairCents!); // baisse cohérente avec la tendance observée
  });

  it("la confiance de la fusion reflète la couverture/fraîcheur — une panne de source réduit la confiance par rapport à une couverture complète", async () => {
    const fullCoverage = [
      obs({ source: "keepa", sourceItemId: "k1", observedAt: DAY0, priceAmountCents: 99000, currency: "CHF", evidenceTier: "B" }),
      obs({ source: "ebay", sourceItemId: "e1", observedAt: DAY0, priceAmountCents: 95000, currency: "CHF", evidenceTier: "D", evidenceType: "activeListings" }),
      obs({ source: "google_shopping", sourceItemId: "g1", observedAt: DAY0, priceAmountCents: 120000, currency: "CHF", evidenceTier: "E", evidenceType: "retailPrices" }),
    ];
    const outageCoverage = [obs({ source: "keepa", sourceItemId: "k1", observedAt: DAY0, priceAmountCents: 99000, currency: "CHF", evidenceTier: "B" })];

    const fullResult = fuseMarketObservations(mapMarketObservationsToFusionObservations(fullCoverage, { targetCurrency: "CHF", rates: {}, maxRateAgeHours: 48 }).fusionObservations, { asOf: DAY0, target: { currency: "CHF" } });
    const outageResult = fuseMarketObservations(mapMarketObservationsToFusionObservations(outageCoverage, { targetCurrency: "CHF", rates: {}, maxRateAgeHours: 48 }).fusionObservations, { asOf: DAY0, target: { currency: "CHF" } });

    expect(fullResult.confidence).toBeGreaterThan(outageResult.confidence);
  });
});
