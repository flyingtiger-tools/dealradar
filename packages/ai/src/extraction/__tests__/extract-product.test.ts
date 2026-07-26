import { describe, expect, it, vi } from "vitest";
import { extractProduct } from "../extract-product";
import { createMemoryCache } from "../../cache/memory-cache";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "../../provider/types";
import type { BudgetGuard } from "../../budget/types";
import type { ExtractionInput } from "../../types";

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

const appleInsufficientInput: ExtractionInput = {
  title: "iPhone en excellent état",
  categorySlug: "apple",
  images: [],
};

describe("extractProduct — ordre paresseux et dégradation gracieuse", () => {
  it("s'arrête au déterministe pour une identification suffisante (LEGO setNumber seul), sans jamais appeler le provider", async () => {
    const extract = vi.fn(async () => ({ raw: {}, usage: { inputUnits: 1, outputUnits: 1 } }));
    const result = await extractProduct(
      { title: "LEGO Star Wars 75313 AT-AT", categorySlug: "lego", images: [{ url: "https://i.ebayimg.com/1.jpg", position: 0 }] },
      { provider: makeProvider(extract), cache: createMemoryCache(), budgetGuard: alwaysGrantBudget() },
    );
    expect(result.source).toBe("deterministic");
    expect(extract).not.toHaveBeenCalled();
    expect(result.product.attributes.setNumber?.value).toBe("75313");
  });

  it("bascule sur l'IA quand le déterministe est insuffisant", async () => {
    const extract = vi.fn(async () => ({
      raw: { model: "iPhone 13", attributes: { storageGb: 128 }, confidence: { model: 0.9, storageGb: 0.9 } },
      usage: { inputUnits: 200, outputUnits: 80 },
    }));
    const result = await extractProduct(appleInsufficientInput, { provider: makeProvider(extract) });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("ai");
    expect(result.product.attributes.storageGb?.value).toBe(128);
  });

  it("gère une réponse IA incomplète sans jamais planter (champs non fournis par l'IA restent ceux du déterministe ou null)", async () => {
    const extract = vi.fn(async () => ({ raw: { brand: "Apple" }, usage: { inputUnits: 50, outputUnits: 10 } }));
    const result = await extractProduct(appleInsufficientInput, { provider: makeProvider(extract) });
    expect(result.product.brand?.value).toBe("Apple");
    expect(result.product.reference).toBeNull();
    expect(result.telemetry.status).toBe("success");
  });

  it("réponse invalide au regard du schéma Zod → repli déterministe + warning, jamais de crash", async () => {
    const extract = vi.fn(async () => ({ raw: { condition: 42 /* pas une chaîne */ }, usage: { inputUnits: 10, outputUnits: 10 } }));
    const result = await extractProduct(appleInsufficientInput, { provider: makeProvider(extract) });
    expect(result.source).toBe("deterministic");
    expect(result.warnings.some((w) => w.code === "INVALID_PROVIDER_RESPONSE")).toBe(true);
  });

  it("erreur réseau/HTTP du provider → repli déterministe, run non interrompu", async () => {
    const extract = vi.fn(async () => {
      throw Object.assign(new Error("réseau indisponible"), { code: "NETWORK" });
    });
    const budgetGuard = alwaysGrantBudget();
    const result = await extractProduct(appleInsufficientInput, { provider: makeProvider(extract), budgetGuard });
    expect(result.source).toBe("deterministic");
    expect(result.warnings.some((w) => w.code === "PROVIDER_ERROR")).toBe(true);
    expect(budgetGuard.finalize).toHaveBeenCalledWith("res-1", expect.objectContaining({ status: "failed" }));
  });

  it("timeout du provider → warning PROVIDER_TIMEOUT, repli déterministe", async () => {
    const extract = vi.fn(async () => {
      throw Object.assign(new Error("délai dépassé"), { code: "TIMEOUT" });
    });
    const result = await extractProduct(appleInsufficientInput, { provider: makeProvider(extract) });
    expect(result.warnings.some((w) => w.code === "PROVIDER_TIMEOUT")).toBe(true);
  });

  it("réservation de budget refusée → aucun appel provider, warning BUDGET_EXCEEDED", async () => {
    const extract = vi.fn(async () => ({ raw: {}, usage: { inputUnits: 1, outputUnits: 1 } }));
    const budgetGuard: BudgetGuard = { reserve: vi.fn(async () => null), finalize: vi.fn(), release: vi.fn() };
    const result = await extractProduct(appleInsufficientInput, { provider: makeProvider(extract), budgetGuard });
    expect(extract).not.toHaveBeenCalled();
    expect(result.warnings.some((w) => w.code === "BUDGET_EXCEEDED")).toBe(true);
    expect(result.telemetry.status).toBe("skipped");
  });

  it("cache hit → provider jamais rappelé, source 'cache'", async () => {
    const cache = createMemoryCache();
    const extract = vi
      .fn()
      .mockResolvedValueOnce({
        raw: { model: "iPhone 13", attributes: { storageGb: 128 }, confidence: { model: 0.9, storageGb: 0.9 } },
        usage: { inputUnits: 100, outputUnits: 50 },
      });

    const first = await extractProduct(appleInsufficientInput, { provider: makeProvider(extract), cache });
    expect(first.source).toBe("ai");

    const second = await extractProduct(appleInsufficientInput, { provider: makeProvider(extract), cache });
    expect(second.source).toBe("cache");
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("un changement de modèle invalide silencieusement l'entrée de cache (clé différente)", async () => {
    const cache = createMemoryCache();
    const extract = vi.fn(async () => ({
      raw: { model: "iPhone 13", attributes: { storageGb: 128 }, confidence: { model: 0.9, storageGb: 0.9 } },
      usage: { inputUnits: 100, outputUnits: 50 },
    }));

    await extractProduct(appleInsufficientInput, { provider: makeProvider(extract), cache });
    const otherModelProvider = { name: "openai", model: "gpt-4o", extract } as AIProvider;
    await extractProduct(appleInsufficientInput, { provider: otherModelProvider, cache });

    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("expiration du cache → le provider est rappelé", async () => {
    const cache = createMemoryCache();
    const extract = vi.fn(async () => ({
      raw: { model: "iPhone 13", attributes: { storageGb: 128 }, confidence: { model: 0.9, storageGb: 0.9 } },
      usage: { inputUnits: 100, outputUnits: 50 },
    }));

    vi.useFakeTimers();
    try {
      await extractProduct(appleInsufficientInput, { provider: makeProvider(extract), cache });
      // Le fallback (sans hash de contenu, seulement l'URL) a un TTL réduit d'1 jour.
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
      await extractProduct(appleInsufficientInput, { provider: makeProvider(extract), cache });
    } finally {
      vi.useRealTimers();
    }
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("eBay faiblement confiant vs IA fortement confiante : l'IA l'emporte", async () => {
    const extract = vi.fn(async () => ({
      raw: { attributes: { storageGb: 256 }, confidence: { storageGb: 0.95 } },
      usage: { inputUnits: 10, outputUnits: 10 },
    }));
    const result = await extractProduct(
      { ...appleInsufficientInput, providedAttributes: { storageGb: 64 } },
      { provider: makeProvider(extract), providedAttributeConfidence: 0.3 },
    );
    expect(result.product.attributes.storageGb?.value).toBe(256);
  });

  it("contradiction majeure entre le déterministe/fourni et l'IA sur un champ critique produit un MAJOR_CONTRADICTION", async () => {
    const extract = vi.fn(async () => ({
      raw: { attributes: { model: "iPhone 15", storageGb: 128 }, confidence: { model: 0.9, storageGb: 0.9 } },
      usage: { inputUnits: 10, outputUnits: 10 },
    }));
    const result = await extractProduct(
      { ...appleInsufficientInput, providedAttributes: { model: "iPhone 8" } },
      { provider: makeProvider(extract), providedAttributeConfidence: 0.9 },
    );
    expect(result.warnings.some((w) => w.code === "MAJOR_CONTRADICTION" && w.field === "model")).toBe(true);
  });

  it("ne stocke ni ne transmet jamais un numéro de série complet, même mentionné dans la description", async () => {
    const extract = vi.fn(async () => ({
      raw: { attributes: { storageGb: 128 }, confidence: { storageGb: 0.9 } },
      usage: { inputUnits: 10, outputUnits: 10 },
    }));
    const result = await extractProduct(
      { ...appleInsufficientInput, description: "Numéro de série: SECRET123456" },
      { provider: makeProvider(extract) },
    );
    expect(JSON.stringify(result)).not.toContain("SECRET123456");
  });

  it("dégrade gracieusement quand aucun provider n'est configuré (pas de clé IA)", async () => {
    const result = await extractProduct(appleInsufficientInput, {});
    expect(result.source).toBe("deterministic");
    expect(result.telemetry.status).toBe("success");
  });
});
