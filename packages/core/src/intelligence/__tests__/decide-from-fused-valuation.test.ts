import { describe, expect, it } from "vitest";
import { decideFromFusedValuation } from "../decide-from-fused-valuation";
import type { FusedValuation } from "../fuse-market-observations";

function fused(overrides: Partial<FusedValuation> = {}): FusedValuation {
  return {
    status: "estimated",
    lowCents: 9000,
    fairCents: 10000,
    highCents: 11000,
    currency: "CHF",
    confidence: 70,
    confidenceComponents: null,
    evidenceCount: 5,
    sourceCount: 3,
    strongestTier: "A",
    evidenceMix: [{ tier: "A", source: "bricklink", merchant: "bricklink", count: 5 }],
    freshnessHours: 1,
    reasons: ["5 observation(s) retenue(s)."],
    insufficiencyReason: null,
    qualityFlags: [],
    historicalReferenceMedianCents: null,
    trendDescriptor: null,
    trendConfidence: null,
    historyStabilizationApplied: false,
    ...overrides,
  };
}

describe("decideFromFusedValuation", () => {
  it("status insuffisant -> INSUFFICIENT_DATA, jamais un score inventé", () => {
    const result = decideFromFusedValuation(fused({ status: "insufficient", strongestTier: null, evidenceMix: [], reasons: ["Aucune observation."] }), null);
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });

  it("palier A avec assez d'évidence haute qualité et bon dealScore -> BUY, en réutilisant decide() sans régression", () => {
    const result = decideFromFusedValuation(
      fused({ strongestTier: "A", confidence: 70, evidenceMix: [{ tier: "A", source: "bricklink", merchant: "bricklink", count: 5 }] }),
      80,
    );
    expect(result.decision).toBe("BUY");
  });

  it("palier B compte aussi comme haute qualité pour le nombre de comparables équivalents", () => {
    const result = decideFromFusedValuation(
      fused({ strongestTier: "B", confidence: 70, evidenceMix: [{ tier: "B", source: "pricecharting", merchant: "pricecharting", count: 5 }] }),
      80,
    );
    expect(result.decision).toBe("BUY");
  });

  it("palier D (annonce active) : jamais BUY même avec un dealScore élevé et une confiance suffisante", () => {
    const result = decideFromFusedValuation(fused({ strongestTier: "D", confidence: 55 }), 90);
    expect(result.decision).not.toBe("BUY");
    expect(result.decision).toBe("REVIEW");
  });

  it("palier E (prix neuf affiché) : jamais PASS/BUY automatique", () => {
    const result = decideFromFusedValuation(fused({ strongestTier: "E", confidence: 30 }), 10);
    expect(["INSUFFICIENT_DATA", "REVIEW"]).toContain(result.decision);
    expect(result.decision).not.toBe("BUY");
    expect(result.decision).not.toBe("PASS");
  });

  it("palier D/E avec confiance sous le plancher -> INSUFFICIENT_DATA plutôt que REVIEW", () => {
    const result = decideFromFusedValuation(fused({ strongestTier: "D", confidence: 20 }), 50);
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });

  it("palier D/E avec confiance suffisante -> REVIEW, jamais une décision automatique forte", () => {
    const result = decideFromFusedValuation(fused({ strongestTier: "D", confidence: 50 }), 50);
    expect(result.decision).toBe("REVIEW");
  });

  it("palier A mais trop peu d'évidence haute qualité -> INSUFFICIENT_DATA (cohérent avec decide() existant)", () => {
    const result = decideFromFusedValuation(
      fused({ strongestTier: "A", confidence: 70, evidenceMix: [{ tier: "A", source: "bricklink", merchant: "bricklink", count: 1 }] }),
      80,
    );
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });
});
