import { describe, expect, it } from "vitest";
import { decide } from "../decision";

const base = { minSoldComparablesForStrongRecommendation: 5 };

describe("decide", () => {
  it("ne recommande jamais BUY sous le plancher de comparables, même avec un excellent score", () => {
    const { decision } = decide({ ...base, soldComparablesCount: 1, dealScore: 95, confidenceScore: 90 });
    expect(decision).toBe("INSUFFICIENT_DATA");
  });

  it("ne recommande jamais BUY sous le plancher de confiance", () => {
    const { decision } = decide({ ...base, soldComparablesCount: 8, dealScore: 95, confidenceScore: 20 });
    expect(decision).toBe("INSUFFICIENT_DATA");
  });

  it("retourne INSUFFICIENT_DATA si aucun deal score n'a pu être calculé", () => {
    const { decision } = decide({ ...base, soldComparablesCount: 8, dealScore: null, confidenceScore: 90 });
    expect(decision).toBe("INSUFFICIENT_DATA");
  });

  it("recommande BUY avec un score élevé, assez de comparables et une confiance forte", () => {
    const { decision } = decide({ ...base, soldComparablesCount: 6, dealScore: 85, confidenceScore: 75 });
    expect(decision).toBe("BUY");
  });

  it("rétrograde en REVIEW un bon score si l'échantillon est sous le seuil de recommandation forte", () => {
    const { decision } = decide({ ...base, soldComparablesCount: 4, dealScore: 85, confidenceScore: 75 });
    expect(decision).toBe("REVIEW");
  });

  it("recommande PASS pour une marge insuffisante", () => {
    const { decision } = decide({ ...base, soldComparablesCount: 8, dealScore: 20, confidenceScore: 80 });
    expect(decision).toBe("PASS");
  });

  it("recommande REVIEW pour une opportunité moyenne", () => {
    const { decision } = decide({ ...base, soldComparablesCount: 8, dealScore: 50, confidenceScore: 80 });
    expect(decision).toBe("REVIEW");
  });
});
