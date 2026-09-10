import { describe, expect, it } from "vitest";
import { findProviderCapabilities } from "../capabilities";

describe("findProviderCapabilities", () => {
  it("modèle connu et vision-capable (openai/gpt-4o-mini) : vision true", () => {
    expect(findProviderCapabilities("openai", "gpt-4o-mini")).toEqual({ vision: true, jsonMode: true, usageReporting: true });
  });

  it("modèle connu et TEXTE SEUL (groq/llama-3.3-70b-versatile) : vision false, jamais true par défaut", () => {
    const capabilities = findProviderCapabilities("groq", "llama-3.3-70b-versatile");
    expect(capabilities).not.toBeNull();
    expect(capabilities!.vision).toBe(false);
  });

  it("modèle absent de la table : null (capacités inconnues), jamais une capacité devinée", () => {
    expect(findProviderCapabilities("openai", "un-modele-jamais-releve")).toBeNull();
    expect(findProviderCapabilities("provider-inconnu", "x")).toBeNull();
  });
});
