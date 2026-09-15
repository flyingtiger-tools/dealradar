import {
  getDealTierFromDecision,
  getRafStateForDealTier,
  getRafStateForIdentificationStatus,
  getRafStateForProgress,
  getVerdictLabel,
} from "../raf-mapping";

/** Tests du mapping Raf — source unique de vérité (Phase 30 "Raf mapping"). */

describe("getRafStateForIdentificationStatus", () => {
  it("mappe les 4 statuts réels sans exception", () => {
    expect(getRafStateForIdentificationStatus("identified")).toBe("happy");
    expect(getRafStateForIdentificationStatus("needs_confirmation")).toBe("thinking");
    expect(getRafStateForIdentificationStatus("insufficient_data")).toBe("warning");
    expect(getRafStateForIdentificationStatus("failed")).toBe("warning");
  });
});

describe("getRafStateForProgress", () => {
  it("mappe les 3 phases réseau réelles", () => {
    expect(getRafStateForProgress("uploading")).toBe("scanning");
    expect(getRafStateForProgress("submitting")).toBe("analyzing");
    expect(getRafStateForProgress("polling")).toBe("searching");
  });
});

describe("getDealTierFromDecision", () => {
  it("PASS -> bad, quel que soit le score (jamais une décision concurrente)", () => {
    expect(getDealTierFromDecision("PASS", 99)).toBe("bad");
    expect(getDealTierFromDecision("PASS", null)).toBe("bad");
  });

  it("INSUFFICIENT_DATA -> risk", () => {
    expect(getDealTierFromDecision("INSUFFICIENT_DATA", null)).toBe("risk");
  });

  it("REVIEW -> average", () => {
    expect(getDealTierFromDecision("REVIEW", 60)).toBe("average");
  });

  it("BUY sans score -> good (repli honnête, jamais une valeur inventée)", () => {
    expect(getDealTierFromDecision("BUY", null)).toBe("good");
  });

  it("BUY avec score affine good/excellent/exceptional", () => {
    expect(getDealTierFromDecision("BUY", 70)).toBe("good");
    expect(getDealTierFromDecision("BUY", 85)).toBe("excellent");
    expect(getDealTierFromDecision("BUY", 95)).toBe("exceptional");
  });
});

describe("getRafStateForDealTier", () => {
  it("mappe les 6 paliers vers les 6 états Raf attendus (Phase 10)", () => {
    expect(getRafStateForDealTier("bad")).toBe("badDeal");
    expect(getRafStateForDealTier("risk")).toBe("warning");
    expect(getRafStateForDealTier("average")).toBe("thinking");
    expect(getRafStateForDealTier("good")).toBe("goodDeal");
    expect(getRafStateForDealTier("excellent")).toBe("gem");
    expect(getRafStateForDealTier("exceptional")).toBe("megaDeal");
  });
});

describe("getVerdictLabel", () => {
  it("dérive le libellé FR sans renommer l'enum métier", () => {
    expect(getVerdictLabel("BUY")).toBe("ACHETER");
    expect(getVerdictLabel("REVIEW")).toBe("ATTENDRE");
    expect(getVerdictLabel("PASS")).toBe("PASSER");
    expect(getVerdictLabel("INSUFFICIENT_DATA")).toBe("DONNÉES INSUFFISANTES");
  });
});
