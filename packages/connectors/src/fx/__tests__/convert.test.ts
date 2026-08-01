import { describe, expect, it } from "vitest";
import type { NormalizedPriceObservation } from "../../types";
import type { FxRate } from "../types";
import { convertPriceObservation } from "../convert";

const NOW = new Date("2026-07-31T12:00:00.000Z");

function observation(overrides: Partial<NormalizedPriceObservation> = {}): NormalizedPriceObservation {
  return {
    source: "justtcg",
    externalProductId: "v1",
    game: "Pokémon",
    name: "Pikachu",
    setName: "Base Set",
    setId: "base4",
    number: "58",
    variant: "Normal",
    language: "English",
    condition: "Near Mint",
    gradingCompany: null,
    grade: null,
    amountCents: 1000,
    currency: "USD",
    priceType: "market_aggregate",
    updatedAt: "2026-07-30T00:00:00.000Z",
    region: "US",
    provenance: "justtcg-api-v2",
    confidence: 1,
    warnings: [],
    ...overrides,
  };
}

function rate(overrides: Partial<FxRate> = {}): FxRate {
  return {
    baseCurrency: "USD",
    quoteCurrency: "CHF",
    rate: 0.9,
    rateDate: "2026-07-31",
    source: "openexchangerates",
    fetchedAt: "2026-07-31T08:00:00.000Z",
    ...overrides,
  };
}

describe("convertPriceObservation", () => {
  it("convertit correctement, conserve le montant et la devise d'origine intacts", () => {
    const obs = observation();
    const outcome = convertPriceObservation(obs, rate(), { maxRateAgeHours: 24, now: () => NOW });

    expect(outcome.status).toBe("converted");
    if (outcome.status !== "converted") throw new Error("unreachable");
    expect(outcome.conversion.originalAmountCents).toBe(1000);
    expect(outcome.conversion.originalCurrency).toBe("USD");
    expect(outcome.conversion.convertedAmountCents).toBe(900);
    expect(outcome.conversion.convertedCurrency).toBe("CHF");
    expect(outcome.conversion.rate).toBe(0.9);
    expect(outcome.conversion.rateDate).toBe("2026-07-31");
    // L'observation d'origine n'est jamais modifiée en place.
    expect(obs.amountCents).toBe(1000);
    expect(obs.currency).toBe("USD");
    expect(obs.conversion).toBeUndefined();
  });

  it("l'avertissement cross-market est toujours présent, jamais une valeur vide", () => {
    const outcome = convertPriceObservation(observation(), rate(), { maxRateAgeHours: 24, now: () => NOW });
    if (outcome.status !== "converted") throw new Error("unreachable");
    expect(outcome.conversion.warning.length).toBeGreaterThan(0);
    expect(outcome.conversion.warning).toContain("USD");
    expect(outcome.conversion.warning).toContain("CHF");
  });

  it("refuse un taux absent — jamais un taux inventé ou par défaut", () => {
    const outcome = convertPriceObservation(observation(), null, { maxRateAgeHours: 24, now: () => NOW });
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toMatch(/aucun taux/i);
  });

  it("refuse un taux trop ancien plutôt que de l'utiliser silencieusement", () => {
    const staleRate = rate({ rateDate: "2026-07-01" }); // 30 jours avant NOW
    const outcome = convertPriceObservation(observation(), staleRate, { maxRateAgeHours: 24, now: () => NOW });
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toMatch(/trop ancien/i);
  });

  it("accepte un taux dans la fenêtre autorisée", () => {
    const freshRate = rate({ rateDate: "2026-07-30" }); // ~36h avant NOW, sous une fenêtre de 48h
    const outcome = convertPriceObservation(observation(), freshRate, { maxRateAgeHours: 48, now: () => NOW });
    expect(outcome.status).toBe("converted");
  });

  it("refuse une paire de devises incompatible (taux USD, observation EUR)", () => {
    const obs = observation({ currency: "EUR" });
    const outcome = convertPriceObservation(obs, rate({ baseCurrency: "USD" }), { maxRateAgeHours: 24, now: () => NOW });
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toMatch(/incompatible/i);
  });

  it("refuse un taux non positif", () => {
    const outcome = convertPriceObservation(observation(), rate({ rate: 0 }), { maxRateAgeHours: 24, now: () => NOW });
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toMatch(/invalide/i);
  });

  it("refuse de convertir deux fois la même observation", () => {
    const first = convertPriceObservation(observation(), rate(), { maxRateAgeHours: 24, now: () => NOW });
    if (first.status !== "converted") throw new Error("unreachable");

    const alreadyConverted = observation({ conversion: first.conversion });
    const second = convertPriceObservation(alreadyConverted, rate(), { maxRateAgeHours: 24, now: () => NOW });

    expect(second.status).toBe("refused");
    if (second.status !== "refused") throw new Error("unreachable");
    expect(second.reason).toMatch(/déjà convertie/i);
  });
});
