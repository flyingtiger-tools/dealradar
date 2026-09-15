import type { TcgCardAnalysisResult } from "@dealradar/contracts";
import { mapTcgResultToViewModel } from "../result-view-model";

/**
 * Tests du mapper résultat TCG (Phase 30 "result mapping", "no-price
 * state") — le seul mapper réel contrat -> vue, doit rester le seul
 * endroit qui décide "identifié" vs "non identifié" (signal = `identity`,
 * jamais `status` seul).
 */

function baseResult(overrides: Partial<TcgCardAnalysisResult> = {}): TcgCardAnalysisResult {
  return {
    kind: "pokemon_tcg_card",
    needsConfirmation: false,
    extractedFields: {
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
    },
    identity: null,
    priceObservations: [],
    warnings: [],
    reason: null,
    ...overrides,
  };
}

describe("mapTcgResultToViewModel", () => {
  it("identité + prix : identityStatus 'identified', hasPricing true", () => {
    const result = baseResult({
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
        confidence: 0.97,
        catalogCorroboration: "corroborated",
      },
      priceObservations: [
        { source: "tcgdex", provenance: "cardmarket", amountCents: 963, currency: "CHF", condition: null, variant: null, language: null, gradingCompany: null, grade: null, region: "EU", updatedAt: "2026-09-15T00:00:00Z", conversion: null, warnings: [] },
      ],
    });

    const view = mapTcgResultToViewModel(result, "completed");

    expect(view.identityStatus).toBe("identified");
    expect(view.product.name).toBe("Pikachu");
    expect(view.confidencePercent).toBe(97);
    expect(view.hasPricing).toBe(true);
    expect(view.prices).toHaveLength(1);
    expect(view.prices[0]!.amountCents).toBe(963);
  });

  it("identité SANS prix (no-price state, Phase 19) : identityStatus reste 'identified', jamais un échec", () => {
    const result = baseResult({
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
        catalogCorroboration: "single_catalog_source",
      },
      priceObservations: [],
    });

    const view = mapTcgResultToViewModel(result, "insufficient_data");

    expect(view.identityStatus).toBe("identified");
    expect(view.hasPricing).toBe(false);
    expect(view.prices).toEqual([]);
    expect(view.product.name).toBe("Pikachu");
  });

  it("aucune identité, status insufficient_data : identityStatus 'insufficient_data', jamais 'failed'", () => {
    const result = baseResult({ identity: null, reason: "catalog_no_match" });

    const view = mapTcgResultToViewModel(result, "insufficient_data");

    expect(view.identityStatus).toBe("insufficient_data");
    expect(view.product.name).toBeNull();
  });

  it("aucune identité, status failed : identityStatus 'failed'", () => {
    const result = baseResult({ identity: null });

    const view = mapTcgResultToViewModel(result, "failed");

    expect(view.identityStatus).toBe("failed");
  });

  it("result null (échec réseau avant réponse) : identityStatus dérivé du status, jamais un crash", () => {
    const view = mapTcgResultToViewModel(null, "failed");

    expect(view.identityStatus).toBe("failed");
    expect(view.reasonMessage).not.toBeNull();
  });

  it("decision/dealScore/reasons toujours null/[] pour un résultat TCG réel — jamais inventés par le mapper", () => {
    const result = baseResult({
      identity: {
        catalogExternalId: "base1-58",
        game: "pokemon",
        name: "Pikachu",
        setName: null,
        cardNumber: null,
        variant: null,
        language: null,
        productKind: "raw_card",
        gradingCompany: null,
        grade: null,
        confidence: 0.8,
        catalogCorroboration: "corroborated",
      },
    });

    const view = mapTcgResultToViewModel(result, "completed");

    expect(view.decision).toBeNull();
    expect(view.dealScore).toBeNull();
    expect(view.reasons).toEqual([]);
    expect(view.isDemo).toBe(false);
  });
});
