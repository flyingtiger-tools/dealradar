import { describe, expect, it, vi } from "vitest";
import { extractTcgCardFromPhoto } from "../extract-tcg-card";
import { createMemoryCache } from "../../cache/memory-cache";
import { ProviderError } from "../../provider/http";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "../../provider/types";
import type { BudgetGuard } from "../../budget/types";

function makeProvider(extract: (request: AIProviderRequest) => Promise<AIProviderResponse>): AIProvider {
  return { name: "openai", model: "gpt-4o-mini", extract };
}

function alwaysGrantBudget(): BudgetGuard {
  return {
    reserve: vi.fn(async () => ({ reservationId: "res-1" })),
    finalize: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
}

const baseInput = { imageStorageKey: "user-1/req-1/photo.jpg", imageUrl: "https://storage.example.test/signed/photo.jpg?token=abc" };

const FULL_CARD_RAW = {
  game: "Pokémon",
  cardName: "Pikachu",
  setName: "Base Set",
  cardNumber: "58",
  variant: "Normal",
  language: "English",
  productKind: "raw_card",
  gradingCompany: null,
  grade: null,
  overallConfidence: 0.95,
  confidence: { cardName: 0.98, setName: 0.9, cardNumber: 0.92, variant: 0.85, language: 0.8 },
};

describe("extractTcgCardFromPhoto", () => {
  it("appelle le provider avec le prompt dédié et l'URL de l'image, jamais de titre requis", async () => {
    const extract = vi.fn(async (request: AIProviderRequest) => {
      expect(request.images).toEqual([{ url: baseInput.imageUrl }]);
      expect(request.system).toContain("Pokémon Trading Card Game");
      return { raw: FULL_CARD_RAW, usage: { inputUnits: 100, outputUnits: 40 } };
    });
    const result = await extractTcgCardFromPhoto(baseInput, { provider: makeProvider(extract) });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("ai");
    expect(result.extraction.cardName).toEqual({ value: "Pikachu", confidence: 0.98 });
    expect(result.extraction.setName).toEqual({ value: "Base Set", confidence: 0.9 });
    expect(result.extraction.productKind).toEqual({ value: "raw_card", confidence: 0.6 });
    expect(result.extraction.overallConfidence).toBe(0.95);
  });

  it("champ non détecté par le modèle reste null, jamais une supposition", async () => {
    const extract = vi.fn(async () => ({
      raw: { cardName: "Charizard", overallConfidence: 0.3 },
      usage: { inputUnits: 100, outputUnits: 30 },
    }));
    const result = await extractTcgCardFromPhoto(baseInput, { provider: makeProvider(extract) });

    expect(result.extraction.cardName.value).toBe("Charizard");
    expect(result.extraction.setName.value).toBeNull();
    expect(result.extraction.cardNumber.value).toBeNull();
    expect(result.extraction.gradingCompany.value).toBeNull();
    expect(result.extraction.overallConfidence).toBe(0.3);
  });

  it("réutilise le cache pour la même clé de stockage image (jamais un second appel provider)", async () => {
    const extract = vi.fn(async () => ({ raw: FULL_CARD_RAW, usage: { inputUnits: 100, outputUnits: 40 } }));
    const cache = createMemoryCache();
    const options = { provider: makeProvider(extract), cache };

    const first = await extractTcgCardFromPhoto(baseInput, options);
    const second = await extractTcgCardFromPhoto(baseInput, options);

    expect(extract).toHaveBeenCalledTimes(1);
    expect(first.source).toBe("ai");
    expect(second.source).toBe("cache");
    expect(second.extraction.cardName.value).toBe("Pikachu");
    expect(second.extraction.setName.value).toBe("Base Set");
  });

  it("une URL signée différente pour la même image (même clé de stockage) reste un hit de cache — la clé de cache ignore l'URL", async () => {
    const extract = vi.fn(async () => ({ raw: FULL_CARD_RAW, usage: { inputUnits: 100, outputUnits: 40 } }));
    const cache = createMemoryCache();
    const options = { provider: makeProvider(extract), cache };

    await extractTcgCardFromPhoto(baseInput, options);
    const second = await extractTcgCardFromPhoto(
      { ...baseInput, imageUrl: "https://storage.example.test/signed/photo.jpg?token=completely-different" },
      options,
    );

    expect(extract).toHaveBeenCalledTimes(1);
    expect(second.source).toBe("cache");
  });

  it("clé de stockage différente (photo différente) : pas de hit de cache", async () => {
    const extract = vi.fn(async () => ({ raw: FULL_CARD_RAW, usage: { inputUnits: 100, outputUnits: 40 } }));
    const cache = createMemoryCache();
    const options = { provider: makeProvider(extract), cache };

    await extractTcgCardFromPhoto(baseInput, options);
    await extractTcgCardFromPhoto({ ...baseInput, imageStorageKey: "user-1/req-2/photo.jpg" }, options);

    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("réponse provider invalide au regard du schéma → warning, jamais de crash, tous les champs null", async () => {
    const extract = vi.fn(async () => ({ raw: { productKind: "not-a-real-kind" }, usage: { inputUnits: 10, outputUnits: 10 } }));
    const result = await extractTcgCardFromPhoto(baseInput, { provider: makeProvider(extract) });

    expect(result.warnings).toContain("INVALID_PROVIDER_RESPONSE");
    expect(result.extraction.cardName.value).toBeNull();
  });

  it("budget épuisé : aucun appel provider, warning explicite", async () => {
    const extract = vi.fn(async () => ({ raw: FULL_CARD_RAW, usage: { inputUnits: 1, outputUnits: 1 } }));
    const budgetGuard: BudgetGuard = { reserve: vi.fn(async () => null), finalize: vi.fn(), release: vi.fn() };

    const result = await extractTcgCardFromPhoto(baseInput, { provider: makeProvider(extract), budgetGuard });

    expect(extract).not.toHaveBeenCalled();
    expect(result.warnings).toContain("BUDGET_EXCEEDED");
  });

  it("erreur réseau du provider → warning PROVIDER_ERROR, jamais de crash, budget finalisé en échec", async () => {
    const extract = vi.fn(async () => {
      throw new ProviderError("Erreur réseau lors de l'appel au provider IA.", { code: "NETWORK", retryable: true });
    });
    const budgetGuard = alwaysGrantBudget();
    const result = await extractTcgCardFromPhoto(baseInput, { provider: makeProvider(extract), budgetGuard });

    expect(result.warnings).toContain("PROVIDER_ERROR");
    expect(budgetGuard.finalize).toHaveBeenCalledWith("res-1", expect.objectContaining({ status: "failed" }));
  });

  it("timeout du provider → warning PROVIDER_TIMEOUT", async () => {
    const extract = vi.fn(async () => {
      throw new ProviderError("Délai dépassé lors de l'appel au provider IA.", { code: "TIMEOUT", retryable: true });
    });
    const result = await extractTcgCardFromPhoto(baseInput, { provider: makeProvider(extract) });

    expect(result.warnings).toContain("PROVIDER_TIMEOUT");
  });

  it("erreur ProviderError (ex. 401/429/500) : la télémétrie porte le statut HTTP et un message déjà nettoyé, jamais un objet brut", async () => {
    const extract = vi.fn(async () => {
      throw new ProviderError("Provider IA a répondu 401 (authentification).", { code: "UNAUTHORIZED", httpStatus: 401, retryable: false });
    });
    const result = await extractTcgCardFromPhoto(baseInput, { provider: makeProvider(extract) });

    expect(result.telemetry.status).toBe("error");
    expect(result.telemetry.errorCode).toBe("UNAUTHORIZED");
    expect(result.telemetry.errorHttpStatus).toBe(401);
    expect(result.telemetry.errorMessage).toBe("Provider IA a répondu 401 (authentification).");
    expect(JSON.stringify(result.telemetry)).not.toMatch(/bearer|x-api-key|sk-/i);
  });

  it("erreur sans code reconnu (jamais une ProviderError) : errorHttpStatus reste null, jamais deviné", async () => {
    const extract = vi.fn(async () => {
      throw new Error("panne inattendue");
    });
    const result = await extractTcgCardFromPhoto(baseInput, { provider: makeProvider(extract) });

    expect(result.telemetry.errorCode).toBe("UNKNOWN");
    expect(result.telemetry.errorHttpStatus).toBeNull();
    expect(result.telemetry.errorMessage).toBe("panne inattendue");
  });
});
