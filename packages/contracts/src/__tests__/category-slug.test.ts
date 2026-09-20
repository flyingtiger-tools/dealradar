import { describe, expect, it } from "vitest";
import { categorySlugSchema } from "../category-slug";

describe("categorySlugSchema", () => {
  it("accepts every supported category", () => {
    for (const value of [
      "lego",
      "pokemon_tcg",
      "apple",
      "gaming",
      "photo",
      "sneakers",
      "watches",
      "pc_components",
      "collectibles",
      "general",
    ]) {
      expect(categorySlugSchema.parse(value)).toBe(value);
    }
  });

  it("rejects any value outside the enum", () => {
    expect(categorySlugSchema.safeParse("cars").success).toBe(false);
    expect(categorySlugSchema.safeParse("").success).toBe(false);
  });
});
