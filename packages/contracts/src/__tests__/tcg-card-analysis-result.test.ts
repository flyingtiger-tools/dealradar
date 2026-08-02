import { describe, expect, it } from "vitest";
import { tcgCardAnalysisResultSchema } from "../tcg-card-analysis-result";
import { analysisResponseSchema } from "../analysis-result";
import { analysisRequestSchema } from "../analysis-request";

const validResult = {
  kind: "pokemon_tcg_card" as const,
  needsConfirmation: false,
  extractedFields: {
    category: "pokemon_tcg" as const,
    game: "Pokémon",
    cardName: "Pikachu",
    setName: "Base Set",
    cardNumber: "58",
    variant: "Normal",
    language: "English",
    productKind: "raw_card" as const,
    gradingCompany: null,
    grade: null,
    confidence: 0.95,
    warnings: [],
  },
  identity: {
    catalogExternalId: "base1-58",
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
    catalogCorroboration: "corroborated" as const,
  },
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
      conversion: {
        originalAmountCents: 768,
        originalCurrency: "USD",
        rate: 0.9,
        rateDate: "2026-08-01",
        convertedAmountCents: 691,
        convertedCurrency: "CHF",
        warning: "Converti USD→CHF au taux du 2026-08-01 (source : frankfurter) — ne représente jamais une vente confirmée en CHF.",
      },
      warnings: [],
    },
  ],
  warnings: [],
  reason: null,
};

describe("tcgCardAnalysisResultSchema", () => {
  it("valide un résultat complet réel (identité corroborée + observation convertie)", () => {
    expect(tcgCardAnalysisResultSchema.parse(validResult)).toEqual(validResult);
  });

  it("valide un résultat needsConfirmation (identity/priceObservations vides)", () => {
    const needsConfirmation = {
      ...validResult,
      needsConfirmation: true,
      identity: null,
      priceObservations: [],
      reason: null,
    };
    expect(tcgCardAnalysisResultSchema.parse(needsConfirmation).needsConfirmation).toBe(true);
  });

  it("rejette un kind incorrect", () => {
    expect(tcgCardAnalysisResultSchema.safeParse({ ...validResult, kind: "generic_decision" }).success).toBe(false);
  });
});

describe("analysisResponseSchema — union résultat générique / carte TCG", () => {
  it("accepte un résultat de scan carte TCG dans result", () => {
    const response = { id: "550e8400-e29b-41d4-a716-446655440000", status: "completed", result: validResult };
    const parsed = analysisResponseSchema.parse(response);
    expect(parsed.result).not.toBeNull();
    if (parsed.result && "kind" in parsed.result) {
      expect(parsed.result.kind).toBe("pokemon_tcg_card");
    }
  });

  it("accepte toujours result: null", () => {
    const response = { id: "550e8400-e29b-41d4-a716-446655440000", status: "pending", result: null };
    expect(analysisResponseSchema.parse(response).result).toBeNull();
  });
});

describe("analysisRequestSchema — providedTcgHints optionnel", () => {
  it("accepte une requête sans providedTcgHints (défaut null)", () => {
    const parsed = analysisRequestSchema.parse({
      sourceType: "mobile_camera",
      consentVersion: "1",
      clientRequestId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(parsed.providedTcgHints).toBeNull();
  });

  it("accepte des hints TCG corrigés explicitement", () => {
    const parsed = analysisRequestSchema.parse({
      sourceType: "mobile_camera",
      categorySlug: "pokemon_tcg",
      consentVersion: "1",
      clientRequestId: "550e8400-e29b-41d4-a716-446655440000",
      providedTcgHints: {
        cardName: "Pikachu",
        setName: "Base Set",
        cardNumber: "58",
        variant: null,
        language: null,
        productKind: null,
        gradingCompany: null,
        grade: null,
      },
    });
    expect(parsed.providedTcgHints?.cardName).toBe("Pikachu");
  });
});
