import { describe, expect, it } from "vitest";
import { CATEGORY_PROFILES, resolveCategoryProfile } from "../category-profiles";

describe("CATEGORY_PROFILES", () => {
  it("définit les 5 catégories attendues, chacune avec une configuration complète", () => {
    const slugs = Object.keys(CATEGORY_PROFILES).sort();
    expect(slugs).toEqual(["apple", "gaming", "lego", "photo", "pokemon_tcg"]);

    for (const profile of Object.values(CATEGORY_PROFILES)) {
      expect(profile.requiredAttributeKeys.length).toBeGreaterThan(0);
      expect(profile.similarityAttributeKeys.length).toBeGreaterThan(0);
      expect(profile.riskSignals.length).toBeGreaterThan(0);
      expect(profile.minSoldComparablesForStrongRecommendation).toBeGreaterThanOrEqual(5);
    }
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
