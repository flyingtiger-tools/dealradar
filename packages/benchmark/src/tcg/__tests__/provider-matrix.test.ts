import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildProviderForMatrixEntry } from "../provider-matrix";

describe("buildProviderForMatrixEntry — COÛT = 0 par défaut", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("sans options.live : toujours simulé, même si une vraie clé est présente dans l'environnement", () => {
    process.env.GROQ_API_KEY = "gsk-real-key-present";
    const built = buildProviderForMatrixEntry({ provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(built.mode).toBe("simulated");
    expect(built.provider.name).toBe("simulated");
  });

  it("options.live=true mais clé absente : repli honnête sur simulé, jamais une erreur", () => {
    const built = buildProviderForMatrixEntry({ provider: "groq", model: "llama-3.3-70b-versatile" }, { live: true });
    expect(built.mode).toBe("simulated");
  });

  it("options.live=true avec une clé réelle présente : construit un provider live pour chacun des 4 providers", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.GROQ_API_KEY = "gsk-test";
    process.env.OPENROUTER_API_KEY = "or-test";

    const openai = buildProviderForMatrixEntry({ provider: "openai", model: "gpt-4o-mini" }, { live: true });
    const anthropic = buildProviderForMatrixEntry({ provider: "anthropic", model: "claude-haiku-4-5-20251001" }, { live: true });
    const groq = buildProviderForMatrixEntry({ provider: "groq", model: "llama-3.3-70b-versatile" }, { live: true });
    const openrouter = buildProviderForMatrixEntry({ provider: "openrouter", model: "openai/gpt-4o-mini" }, { live: true });

    expect(openai.mode).toBe("live");
    expect(openai.provider.name).toBe("openai");
    expect(anthropic.mode).toBe("live");
    expect(anthropic.provider.name).toBe("anthropic");
    expect(groq.mode).toBe("live");
    expect(groq.provider.name).toBe("groq");
    expect(openrouter.mode).toBe("live");
    expect(openrouter.provider.name).toBe("openrouter");
  });

  it("le modèle demandé par l'entrée de matrice est conservé sur le provider simulé, pour l'étiquetage du rapport", () => {
    const built = buildProviderForMatrixEntry({ provider: "anthropic", model: "claude-sonnet-5" });
    expect(built.provider.model).toBe("claude-sonnet-5");
    expect(built.entry).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
  });
});
