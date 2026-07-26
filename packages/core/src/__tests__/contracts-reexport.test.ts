import { describe, expect, it } from "vitest";
import { itemConditionSchema as contractsItemConditionSchema, categorySlugSchema } from "@dealradar/contracts";
import { itemConditionSchema } from "../validation/schemas";
import { CATEGORY_PROFILES } from "../intelligence/category-profiles";

/**
 * Non-régression Lot 5 : ItemCondition/CategorySlug ont été déplacés vers
 * @dealradar/contracts. Ce test garantit que packages/core continue
 * d'exposer exactement le même comportement qu'avant le déplacement.
 */
describe("ré-export @dealradar/contracts depuis @dealradar/core", () => {
  it("itemConditionSchema ré-exporté est bien celui de @dealradar/contracts", () => {
    expect(itemConditionSchema).toBe(contractsItemConditionSchema);
    for (const value of ["new", "like_new", "very_good", "good", "fair", "for_parts"]) {
      expect(itemConditionSchema.parse(value)).toBe(value);
    }
  });

  it("les slugs de CATEGORY_PROFILES restent valides au regard de categorySlugSchema", () => {
    for (const slug of Object.keys(CATEGORY_PROFILES)) {
      expect(categorySlugSchema.safeParse(slug).success).toBe(true);
    }
  });
});
