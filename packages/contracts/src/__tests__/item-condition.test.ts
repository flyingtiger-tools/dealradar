import { describe, expect, it } from "vitest";
import { itemConditionSchema } from "../item-condition";

describe("itemConditionSchema", () => {
  it("accepts every known condition value", () => {
    for (const value of ["new", "like_new", "very_good", "good", "fair", "for_parts"]) {
      expect(itemConditionSchema.parse(value)).toBe(value);
    }
  });

  it("rejects any value outside the enum", () => {
    expect(itemConditionSchema.safeParse("mint").success).toBe(false);
    expect(itemConditionSchema.safeParse("").success).toBe(false);
    expect(itemConditionSchema.safeParse(null).success).toBe(false);
  });
});
