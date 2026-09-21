import { describe, expect, it } from "vitest";
import type { MarketObservation } from "@dealradar/connectors";
import { mapMarketObservationsToFusionObservations } from "../map-market-observations-to-fusion";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "ebay",
    sourceItemId: "1",
    sourceUrl: "https://ebay.com/itm/1",
    observedAt: "2026-09-21T00:00:00.000Z",
    productKey: null,
    query: "lego 10300",
    title: "LEGO 10300",
    brand: "LEGO",
    model: "10300",
    variant: null,
    identifiers: { mpn: "10300" },
    condition: "new",
    completeness: null,
    priceAmountCents: 18000,
    currency: "CHF",
    shippingCostCents: 500,
    totalPriceCents: 18500,
    country: "CH",
    marketplace: "ebay",
    evidenceType: "activeListings",
    evidenceTier: "D",
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

const NOW = () => new Date("2026-09-21T12:00:00.000Z");

describe("mapMarketObservationsToFusionObservations", () => {
  it("observation déjà dans la devise cible : passe telle quelle, jamais 'convertie' inutilement", () => {
    const result = mapMarketObservationsToFusionObservations([fakeObservation()], { targetCurrency: "CHF", rates: {}, maxRateAgeHours: 48, now: NOW });
    expect(result.skipped).toEqual([]);
    expect(result.fusionObservations[0]!.priceCents).toBe(18000);
    expect(result.fusionObservations[0]!.currency).toBe("CHF");
  });

  it("utilise TOUJOURS priceAmountCents (prix article), jamais totalPriceCents (port non fondu dans le prix comparé)", () => {
    const result = mapMarketObservationsToFusionObservations([fakeObservation({ priceAmountCents: 18000, totalPriceCents: 18500 })], {
      targetCurrency: "CHF",
      rates: {},
      maxRateAgeHours: 48,
      now: NOW,
    });
    expect(result.fusionObservations[0]!.priceCents).toBe(18000);
  });

  it("devise étrangère avec un taux valide et frais : convertit correctement", () => {
    const observation = fakeObservation({ currency: "USD", priceAmountCents: 10000 });
    const result = mapMarketObservationsToFusionObservations([observation], {
      targetCurrency: "CHF",
      rates: { USD: { baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9, rateDate: "2026-09-21", source: "test", fetchedAt: "2026-09-21T00:00:00.000Z" } },
      maxRateAgeHours: 48,
      now: NOW,
    });
    expect(result.skipped).toEqual([]);
    expect(result.fusionObservations[0]!.priceCents).toBe(9000);
    expect(result.fusionObservations[0]!.currency).toBe("CHF");
  });

  it("devise étrangère sans taux disponible : écartée avec une raison explicite, jamais silencieusement perdue", () => {
    const observation = fakeObservation({ currency: "USD" });
    const result = mapMarketObservationsToFusionObservations([observation], { targetCurrency: "CHF", rates: {}, maxRateAgeHours: 48, now: NOW });
    expect(result.fusionObservations).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain("Aucun taux");
    expect(result.skipped[0]!.reasonClass).toBe("missing_rate");
  });

  it("taux pour la mauvaise paire : refusé plutôt que mal appliqué", () => {
    const observation = fakeObservation({ currency: "USD" });
    const result = mapMarketObservationsToFusionObservations([observation], {
      targetCurrency: "CHF",
      rates: { USD: { baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.9, rateDate: "2026-09-21", source: "test", fetchedAt: "2026-09-21T00:00:00.000Z" } },
      maxRateAgeHours: 48,
      now: NOW,
    });
    expect(result.fusionObservations).toEqual([]);
    expect(result.skipped[0]!.reason).toContain("paire incompatible");
    expect(result.skipped[0]!.reasonClass).toBe("pair_mismatch");
  });

  it("taux trop ancien : refusé plutôt qu'utilisé silencieusement", () => {
    const observation = fakeObservation({ currency: "USD" });
    const result = mapMarketObservationsToFusionObservations([observation], {
      targetCurrency: "CHF",
      rates: { USD: { baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9, rateDate: "2026-01-01", source: "test", fetchedAt: "2026-01-01T00:00:00.000Z" } },
      maxRateAgeHours: 48,
      now: NOW,
    });
    expect(result.fusionObservations).toEqual([]);
    expect(result.skipped[0]!.reason).toContain("trop ancien");
    expect(result.skipped[0]!.reasonClass).toBe("stale_rate");
  });

  it("taux non positif : refusé", () => {
    const observation = fakeObservation({ currency: "USD" });
    const result = mapMarketObservationsToFusionObservations([observation], {
      targetCurrency: "CHF",
      rates: { USD: { baseCurrency: "USD", quoteCurrency: "CHF", rate: -1, rateDate: "2026-09-21", source: "test", fetchedAt: "2026-09-21T00:00:00.000Z" } },
      maxRateAgeHours: 48,
      now: NOW,
    });
    expect(result.fusionObservations).toEqual([]);
    expect(result.skipped[0]!.reason).toContain("invalide");
    expect(result.skipped[0]!.reasonClass).toBe("invalid_rate");
  });

  it("préserve merchant depuis MarketObservation.marketplace pour la diversité de fusion", () => {
    const observation = fakeObservation({ source: "google_shopping", marketplace: "ebay" });
    const result = mapMarketObservationsToFusionObservations([observation], { targetCurrency: "CHF", rates: {}, maxRateAgeHours: 48, now: NOW });
    expect(result.fusionObservations[0]!.source).toBe("google_shopping");
    expect(result.fusionObservations[0]!.merchant).toBe("ebay");
  });

  it("préserve les identifiants connus dans attributes", () => {
    const observation = fakeObservation({ identifiers: { mpn: "10300", ean: "5702017421934" } });
    const result = mapMarketObservationsToFusionObservations([observation], { targetCurrency: "CHF", rates: {}, maxRateAgeHours: 48, now: NOW });
    expect(result.fusionObservations[0]!.attributes).toEqual({ mpn: "10300", ean: "5702017421934" });
  });

  it("liste vide -> résultat vide, jamais une exception", () => {
    const result = mapMarketObservationsToFusionObservations([], { targetCurrency: "CHF", rates: {}, maxRateAgeHours: 48, now: NOW });
    expect(result).toEqual({ fusionObservations: [], skipped: [] });
  });
});
