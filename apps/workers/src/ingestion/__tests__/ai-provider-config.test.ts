import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { extractTcgCardFromPhoto } from "@dealradar/ai";
import type { BudgetGuard } from "@dealradar/ai";
import { buildAiExtractionConfigFromEnv } from "../ai-provider-config";

/**
 * `AI_PROVIDER` sélectionne un provider concret sans jamais retomber sur
 * l'autre — même si sa clé est présente ailleurs dans l'environnement (voir
 * "aucun fallback" ci-dessous). Restaure l'environnement intégralement
 * entre chaque test : ces variables ne doivent jamais fuiter d'un test à l'autre.
 */
describe("buildAiExtractionConfigFromEnv", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const key of ["AI_PROVIDER", "AI_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_DAILY_BUDGET_USD", "AI_MAX_IMAGES", "AI_IMAGE_DOMAIN_ALLOWLIST"]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("AI_PROVIDER absent : aucune configuration, jamais un provider par défaut deviné", () => {
    expect(buildAiExtractionConfigFromEnv()).toBeUndefined();
  });

  it("provider Claude sélectionné : AI_PROVIDER=anthropic + ANTHROPIC_API_KEY construit bien un provider 'anthropic'", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const config = buildAiExtractionConfigFromEnv();

    expect(config).toBeDefined();
    expect(config!.provider.name).toBe("anthropic");
    expect(config!.provider.model).toBe("claude-haiku-4-5-20251001");
  });

  it("AI_MODEL surcharge le modèle Claude par défaut", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.AI_MODEL = "claude-sonnet-5";

    const config = buildAiExtractionConfigFromEnv();

    expect(config!.provider.model).toBe("claude-sonnet-5");
  });

  it("clé absente : AI_PROVIDER=anthropic sans ANTHROPIC_API_KEY désactive l'IA, jamais une erreur", () => {
    process.env.AI_PROVIDER = "anthropic";

    expect(buildAiExtractionConfigFromEnv()).toBeUndefined();
  });

  it("aucun fallback vers OpenAI si Claude est sélectionné, même si OPENAI_API_KEY est présente ailleurs dans l'environnement", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.OPENAI_API_KEY = "sk-openai-present-but-must-be-ignored";
    // ANTHROPIC_API_KEY volontairement absente.

    const config = buildAiExtractionConfigFromEnv();

    expect(config).toBeUndefined();
  });

  it("réciproque : AI_PROVIDER=openai continue de fonctionner sans régression, jamais un provider anthropic construit à sa place", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-openai-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-present-but-must-be-ignored";

    const config = buildAiExtractionConfigFromEnv();

    expect(config!.provider.name).toBe("openai");
    expect(config!.provider.model).toBe("gpt-4o-mini");
  });

  it("AI_PROVIDER non reconnu : aucune configuration, jamais un repli silencieux sur un provider existant", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.OPENAI_API_KEY = "sk-openai-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    expect(buildAiExtractionConfigFromEnv()).toBeUndefined();
  });

  it("budget dépassé : avec le vrai provider Claude branché, le budget guard bloque avant tout appel réseau", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const config = buildAiExtractionConfigFromEnv()!;
    const neverCalledFetch = vi.fn();
    // Le provider construit par buildAiExtractionConfigFromEnv() utilise le
    // vrai fetch global ; on vérifie ici seulement que budgetGuard.reserve()
    // refusant empêche extractTcgCardFromPhoto() d'atteindre provider.extract()
    // — donc jamais un appel réseau réel, quel que soit le provider branché.
    const refusingBudgetGuard: BudgetGuard = {
      reserve: vi.fn(async () => null),
      finalize: vi.fn(),
      release: vi.fn(),
    };
    const originalExtract = config.provider.extract.bind(config.provider);
    config.provider.extract = async (request) => {
      neverCalledFetch();
      return originalExtract(request);
    };

    const result = await extractTcgCardFromPhoto(
      { imageStorageKey: "user-1/req-1/photo.jpg", imageUrl: "https://storage.example.test/signed/photo.jpg" },
      { provider: config.provider, budgetGuard: refusingBudgetGuard },
    );

    expect(neverCalledFetch).not.toHaveBeenCalled();
    expect(result.warnings).toContain("BUDGET_EXCEEDED");
  });
});
