import { describe, expect, it } from "vitest";
import { CATEGORY_PROFILES, resolveCategoryProfile } from "../category-profiles";

describe("CATEGORY_PROFILES", () => {
  it("définit les 10 catégories attendues, chacune avec une configuration complète", () => {
    const slugs = Object.keys(CATEGORY_PROFILES).sort();
    expect(slugs).toEqual([
      "apple",
      "collectibles",
      "gaming",
      "general",
      "lego",
      "pc_components",
      "photo",
      "pokemon_tcg",
      "sneakers",
      "watches",
    ]);

    for (const [slug, profile] of Object.entries(CATEGORY_PROFILES)) {
      // `general` est le seul profil intentionnellement sans champ requis
      // ni clé de similarité (repli structurel — voir category-profiles.ts).
      if (slug !== "general") {
        expect(profile.requiredAttributeKeys.length).toBeGreaterThan(0);
        expect(profile.similarityAttributeKeys.length).toBeGreaterThan(0);
      }
      expect(profile.riskSignals.length).toBeGreaterThan(0);
      expect(profile.minSoldComparablesForStrongRecommendation).toBeGreaterThanOrEqual(5);
    }
  });

  it("le profil générique 'general' n'exige aucun champ et ne filtre que structurellement, mais signale toujours l'appariement grossier", () => {
    const general = CATEGORY_PROFILES.general;
    expect(general.requiredAttributeKeys).toEqual([]);
    expect(general.similarityAttributeKeys).toEqual([]);
    const signal = general.riskSignals.find((r) => r.id === "loosely_matched_category");
    expect(signal).toBeDefined();
    expect(
      signal!.test({
        id: "x",
        sourceSlug: "test",
        title: "Objet quelconque",
        priceCents: 1000,
        currency: "CHF",
        condition: "good",
        categorySlug: "general",
        attributes: {},
      }),
    ).toBe(true);
  });

  it("résout un profil connu et retourne undefined pour une catégorie inconnue", () => {
    expect(resolveCategoryProfile("lego")?.label).toBe("LEGO");
    expect(resolveCategoryProfile("meubles_jardin")).toBeUndefined();
  });

  it("déclenche les signaux de risque déclarés sur une annonce correspondante", () => {
    const appleProfile = CATEGORY_PROFILES.apple;
    const iCloudSignal = appleProfile.riskSignals.find((r) => r.id === "icloud_lock_risk");
    expect(iCloudSignal).toBeDefined();
    expect(
      iCloudSignal!.test({
        id: "l1",
        sourceSlug: "test",
        title: "iPhone 13 verrouillé iCloud, bloqué",
        priceCents: 30000,
        currency: "CHF",
        condition: "good",
        categorySlug: "apple",
        attributes: { model: "iPhone 13", storageGb: 128 },
      }),
    ).toBe(true);
  });
});
