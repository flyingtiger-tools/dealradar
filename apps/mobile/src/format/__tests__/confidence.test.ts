import { toConfidencePercent } from "../confidence";

describe("toConfidencePercent", () => {
  it.each([
    [0, 0],
    [0.42, 42],
    [0.8, 80],
    [1, 100],
  ])("%s -> %s", (input, expected) => {
    expect(toConfidencePercent(input)).toBe(expected);
  });

  it("jamais multiplié deux fois : une valeur 0-1 typique reste dans [0,100]", () => {
    for (const v of [0, 0.1, 0.5, 0.99, 1]) {
      const percent = toConfidencePercent(v);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});
