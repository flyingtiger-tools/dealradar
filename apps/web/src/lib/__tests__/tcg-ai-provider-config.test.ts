import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `buildTcgAiExtractionConfig`/`buildProvider` n'avaient aucun test dédié
 * avant ce lot ("ne bloque plus le projet sur Groq" — audit des providers
 * alternatifs, 2026-09-20) — l'écart préexistait déjà pour Groq, indépendant
 * du choix de provider. Couvre la sélection par `AI_PROVIDER`, la
 * dégradation gracieuse (clé absente -> `undefined`, jamais une exception),
 * et que chaque provider concret (dont `openai`, déjà implémenté et testé
 * unitairement dans `packages/ai/src/provider/__tests__/openai.test.ts`,
 * jamais dupliqué ici) est correctement câblé derrière l'abstraction
 * `AIProvider` commune — sans jamais exercer un vrai appel réseau.
 */

const { mockedEnv } = vi.hoisted(() => ({ mockedEnv: {} as Record<string, unknown> }));

vi.mock("@/env", () => ({ env: mockedEnv }));
vi.mock("@dealradar/ingestion", () => ({
  createSupabaseExtractionCache: vi.fn(() => ({ marker: "cache" })),
  createSupabaseBudgetGuard: vi.fn(() => ({ marker: "budget" })),
}));

import { createSupabaseBudgetGuard, createSupabaseExtractionCache } from "@dealradar/ingestion";
import { buildTcgAiExtractionConfig } from "../tcg-ai-provider-config";

const FAKE_DB = { marker: "db" } as never;

function resetEnv() {
  for (const key of Object.keys(mockedEnv)) delete mockedEnv[key];
}

beforeEach(() => {
  resetEnv();
  vi.mocked(createSupabaseExtractionCache).mockClear();
  vi.mocked(createSupabaseBudgetGuard).mockClear();
});

describe("buildTcgAiExtractionConfig", () => {
  it("retourne undefined quand AI_PROVIDER est absent — jamais une exception (dégradation gracieuse)", () => {
    expect(buildTcgAiExtractionConfig(FAKE_DB)).toBeUndefined();
    expect(createSupabaseExtractionCache).not.toHaveBeenCalled();
  });

  it("retourne undefined quand AI_PROVIDER=openai mais OPENAI_API_KEY est absente", () => {
    mockedEnv.AI_PROVIDER = "openai";
    expect(buildTcgAiExtractionConfig(FAKE_DB)).toBeUndefined();
  });

  it("construit un provider openai avec le modèle par défaut quand AI_MODEL est omis", () => {
    mockedEnv.AI_PROVIDER = "openai";
    mockedEnv.OPENAI_API_KEY = "sk-test-not-a-real-key";

    const config = buildTcgAiExtractionConfig(FAKE_DB);

    expect(config).toBeDefined();
    expect(config!.extractionOptions.provider.name).toBe("openai");
    expect(config!.extractionOptions.provider.model).toBe("gpt-4o-mini");
  });

  it("utilise AI_MODEL quand fourni, plutôt que le défaut", () => {
    mockedEnv.AI_PROVIDER = "openai";
    mockedEnv.OPENAI_API_KEY = "sk-test-not-a-real-key";
    mockedEnv.AI_MODEL = "gpt-4.1-mini";

    const config = buildTcgAiExtractionConfig(FAKE_DB);

    expect(config!.extractionOptions.provider.model).toBe("gpt-4.1-mini");
  });

  it("construit toujours un provider groq correctement (non-régression — comportement déjà en place, inchangé)", () => {
    mockedEnv.AI_PROVIDER = "groq";
    mockedEnv.GROQ_API_KEY = "gsk-test-not-a-real-key";

    const config = buildTcgAiExtractionConfig(FAKE_DB);

    expect(config!.extractionOptions.provider.name).toBe("groq");
    expect(config!.extractionOptions.provider.model).toBe("qwen/qwen3.6-27b");
  });

  it("retourne undefined pour un AI_PROVIDER non reconnu, jamais un provider par défaut inventé", () => {
    mockedEnv.AI_PROVIDER = "gemini";
    expect(buildTcgAiExtractionConfig(FAKE_DB)).toBeUndefined();
  });

  it("passe dailyBudgetUsd=0 (jamais undefined/NaN) au budget guard quand AI_DAILY_BUDGET_USD est absent", () => {
    mockedEnv.AI_PROVIDER = "openai";
    mockedEnv.OPENAI_API_KEY = "sk-test-not-a-real-key";

    buildTcgAiExtractionConfig(FAKE_DB);

    expect(createSupabaseBudgetGuard).toHaveBeenCalledWith(FAKE_DB, expect.objectContaining({ dailyBudgetUsd: 0, provider: "openai", model: "gpt-4o-mini" }));
  });
});
