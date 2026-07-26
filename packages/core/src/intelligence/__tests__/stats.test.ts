import { describe, expect, it } from "vitest";
import { median, percentile, partitionOutliers } from "../stats";

describe("median/percentile", () => {
  it("calcule la médiane d'un échantillon impair", () => {
    expect(median([10, 20, 30])).toBe(20);
  });

  it("calcule la médiane d'un échantillon pair par interpolation", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("calcule p25/p75 sur un échantillon trié", () => {
    const sorted = [100, 200, 300, 400, 500];
    expect(percentile(sorted, 0.25)).toBe(200);
    expect(percentile(sorted, 0.75)).toBe(400);
  });
});

describe("partitionOutliers", () => {
  it("ne filtre rien sous 4 échantillons (borne non fiable)", () => {
    const { kept, excluded } = partitionOutliers([10, 20, 1000], (v) => v);
    expect(kept).toHaveLength(3);
    expect(excluded).toHaveLength(0);
  });

  it("retire une valeur aberrante isolée à partir de 4 échantillons", () => {
    const values = [100, 105, 110, 108, 5000];
    const { kept, excluded } = partitionOutliers(values, (v) => v);
    expect(excluded).toEqual([5000]);
    expect(kept).toEqual([100, 105, 110, 108]);
  });

  it("ne modifie pas la médiane des valeurs conservées après retrait", () => {
    const values = [100, 105, 110, 108, 5000];
    const { kept } = partitionOutliers(values, (v) => v);
    expect(median(kept)).toBe(median([100, 105, 110, 108]));
  });
});
