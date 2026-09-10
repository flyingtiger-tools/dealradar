import { describe, expect, it } from "vitest";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "@dealradar/ai";
import { runTcgExample } from "../run-tcg-example";
import type { TcgGroundTruth } from "../dataset-schema";

function fakeProvider(name: string, model: string, extract: (request: AIProviderRequest) => Promise<AIProviderResponse>): AIProvider {
  return { name, model, extract };
}

function groundTruth(overrides: Partial<TcgGroundTruth> = {}): TcgGroundTruth {
  return {
    id: "nymble-096",
    imagePath: "photos/nymble-096.jpg",
    game: "pokemon",
    cardName: "Nymble",
    setName: "Phantasmal Flames",
    collectorNumber: "096",
    language: "en",
    variant: null,
    productKind: "raw_card",
    gradingCompany: null,
    grade: null,
    tags: [],
    ...overrides,
  };
}

const OPTIONS_BASE = { matrixEntry: { provider: "openai" as const, model: "gpt-4o-mini" }, imageUrl: "file://local.jpg", imageStorageKey: "benchmark/nymble-096" };

describe("runTcgExample — succès et comparaison champ par champ", () => {
  it("extraction parfaite : exactMatch true, tous les champs comparés corrects", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: {
        game: "pokemon",
        cardName: "Nymble",
        setName: "Phantasmal Flames",
        cardNumber: "096",
        language: "en",
        variant: null,
        productKind: "raw_card",
        overallConfidence: 0.95,
        confidence: { cardName: 0.95, setName: 0.9, cardNumber: 0.92, language: 0.9 },
      },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider });

    expect(result.outcome).toBe("success");
    expect(result.exactMatch).toBe(true);
    expect(result.fieldMatches).toEqual({ cardName: true, setName: true, collectorNumber: true, language: true });
    expect(result.needsConfirmation).toBe(false);
    expect(result.hallucinated).toBe(false);
  });

  it("numéro de collection avec padding différent (96 vs 096) : fieldMatches.collectorNumber true (collectorNumbersMatch, pas une comparaison texte brute)", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "96", overallConfidence: 0.9, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth({ collectorNumber: "096" }), { ...OPTIONS_BASE, provider });

    expect(result.fieldMatches.collectorNumber).toBe(true);
  });

  it("numéro de collection réellement différent (96 vs 12) : fieldMatches.collectorNumber false", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "96", overallConfidence: 0.9, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth({ collectorNumber: "12" }), { ...OPTIONS_BASE, provider });

    expect(result.fieldMatches.collectorNumber).toBe(false);
    expect(result.exactMatch).toBe(false);
  });

  it("champ sans vérité terrain (null) : jamais compté dans fieldMatches", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "096", overallConfidence: 0.9, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth({ variant: null }), { ...OPTIONS_BASE, provider });

    expect("variant" in result.fieldMatches).toBe(false);
  });

  it("hallucination : le modèle invente une valeur pour un champ dont la vérité terrain est null", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "096", variant: "Full Art (inventé)", overallConfidence: 0.9, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth({ variant: null }), { ...OPTIONS_BASE, provider });

    expect(result.hallucinated).toBe(true);
  });

  it("hallucination sur gradingCompany : vérité terrain null, valeur inventée détectée même hors champs comparés d'exactitude", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: {
        cardName: "Nymble",
        setName: "Phantasmal Flames",
        cardNumber: "096",
        gradingCompany: "PSA (inventé)",
        overallConfidence: 0.9,
        confidence: {},
      },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth({ gradingCompany: null }), { ...OPTIONS_BASE, provider });

    expect(result.hallucinated).toBe(true);
    // gradingCompany n'est pas un champ de comparaison d'exactitude (COMPARED_FIELDS) : la détection de
    // hallucination doit rester indépendante de fieldMatches.
    expect("gradingCompany" in result.fieldMatches).toBe(false);
  });

  it("hallucination sur grade : vérité terrain null, valeur inventée détectée", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "096", grade: "10 (inventé)", overallConfidence: 0.9, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth({ grade: null }), { ...OPTIONS_BASE, provider });

    expect(result.hallucinated).toBe(true);
  });

  it("productKind attendu non null et correctement rapporté : pas de hallucination", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "096", productKind: "raw_card", overallConfidence: 0.9, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth({ productKind: "raw_card" }), { ...OPTIONS_BASE, provider });

    expect(result.hallucinated).toBe(false);
  });

  it("confiance globale insuffisante : needsConfirmation true (reflète isSufficientForAutoCorroboration, seuil 0.7)", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "096", overallConfidence: 0.5, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider });

    expect(result.needsConfirmation).toBe(true);
  });

  it("nom absent : needsConfirmation true même avec une confiance élevée", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: null, setName: "Phantasmal Flames", cardNumber: "096", overallConfidence: 0.95, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider });

    expect(result.needsConfirmation).toBe(true);
  });
});

describe("runTcgExample — classification des échecs", () => {
  it("réponse JSON invalide côté provider : outcome invalid_json", async () => {
    const provider: AIProvider = {
      name: "openai",
      model: "gpt-4o-mini",
      extract: async () => {
        const { ProviderError } = await import("@dealradar/ai");
        throw new ProviderError("Réponse non JSON.", { code: "INVALID_RESPONSE" });
      },
    };

    const result = await runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider });

    expect(result.outcome).toBe("invalid_json");
    expect(result.needsConfirmation).toBe(true);
  });

  it("JSON bien formé mais hors schéma (ex. productKind invalide) : outcome invalid_schema", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { productKind: "not_a_valid_kind" },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider });

    expect(result.outcome).toBe("invalid_schema");
  });

  it("erreur réseau (429/5xx/timeout) : outcome provider_error", async () => {
    const provider: AIProvider = {
      name: "openai",
      model: "gpt-4o-mini",
      extract: async () => {
        const { ProviderError } = await import("@dealradar/ai");
        throw new ProviderError("Provider a répondu 500.", { code: "RATE_LIMIT", httpStatus: 500, retryable: true });
      },
    };

    const result = await runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider });

    expect(result.outcome).toBe("provider_error");
  });

  it("erreur inattendue non-ProviderError : outcome provider_error, jamais une exception qui remonte", async () => {
    const provider: AIProvider = {
      name: "openai",
      model: "gpt-4o-mini",
      extract: async () => {
        throw new Error("panne inattendue");
      },
    };

    await expect(runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider })).resolves.toMatchObject({ outcome: "provider_error" });
  });
});

describe("runTcgExample — coût, jamais inventé", () => {
  it("modèle absent de la table tarifaire (ex. simulé) : estimatedCostUsd null, jamais 0 par défaut", async () => {
    const provider = fakeProvider("simulated", "simulated-v1", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "096", overallConfidence: 0.9, confidence: {} },
      usage: { inputUnits: 500, outputUnits: 80 },
    }));

    const result = await runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider });

    expect(result.estimatedCostUsd).toBeNull();
  });

  it("modèle présent dans la table tarifaire (openai/gpt-4o-mini) : coût calculé, non null", async () => {
    const provider = fakeProvider("openai", "gpt-4o-mini", async () => ({
      raw: { cardName: "Nymble", setName: "Phantasmal Flames", cardNumber: "096", overallConfidence: 0.9, confidence: {} },
      usage: { inputUnits: 1_000_000, outputUnits: 1_000_000 },
    }));

    const result = await runTcgExample(groundTruth(), { ...OPTIONS_BASE, provider });

    expect(result.estimatedCostUsd).not.toBeNull();
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });
});
