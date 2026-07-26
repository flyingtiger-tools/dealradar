import { describe, expect, it } from "vitest";
import { computeCacheKey, computeTextFingerprint } from "../compute-key";

const BASE = {
  provider: "openai",
  model: "gpt-4o-mini",
  promptVersion: 1,
  schemaVersion: 1,
  deterministicExtractorVersion: 1,
  contentFingerprint: "abc",
};

describe("computeCacheKey", () => {
  it("produit la même clé pour les mêmes paramètres", () => {
    expect(computeCacheKey(BASE)).toBe(computeCacheKey({ ...BASE }));
  });

  it("change de clé quand le modèle change", () => {
    expect(computeCacheKey(BASE)).not.toBe(computeCacheKey({ ...BASE, model: "gpt-4o" }));
  });

  it("change de clé quand la version de prompt change", () => {
    expect(computeCacheKey(BASE)).not.toBe(computeCacheKey({ ...BASE, promptVersion: 2 }));
  });

  it("change de clé quand la version de schéma change", () => {
    expect(computeCacheKey(BASE)).not.toBe(computeCacheKey({ ...BASE, schemaVersion: 2 }));
  });

  it("change de clé quand la version de l'extracteur déterministe change", () => {
    expect(computeCacheKey(BASE)).not.toBe(computeCacheKey({ ...BASE, deterministicExtractorVersion: 2 }));
  });

  it("change de clé quand le fingerprint de contenu change", () => {
    expect(computeCacheKey(BASE)).not.toBe(computeCacheKey({ ...BASE, contentFingerprint: "def" }));
  });
});

describe("computeTextFingerprint", () => {
  it("est stable pour un texte identique (insensible à la casse/espaces)", () => {
    const a = computeTextFingerprint({ title: "LEGO 75313", description: null, categorySlug: "lego" });
    const b = computeTextFingerprint({ title: "  lego 75313  ", description: null, categorySlug: "lego" });
    expect(a).toBe(b);
  });

  it("change quand le titre change", () => {
    const a = computeTextFingerprint({ title: "LEGO 75313", description: null, categorySlug: "lego" });
    const b = computeTextFingerprint({ title: "LEGO 75314", description: null, categorySlug: "lego" });
    expect(a).not.toBe(b);
  });
});
