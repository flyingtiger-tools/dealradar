jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystemModule());
jest.mock("expo-crypto", () => ({ randomUUID: () => `mock-uuid-${Math.random()}` }));

import { saveAnalysisResultToHistory } from "../save-result";
import { clearHistory, listHistory } from "../storage";
import type { ResultViewModel } from "../../screens/result/result-view-model";

function view(overrides: Partial<ResultViewModel> = {}): ResultViewModel {
  return {
    identityStatus: "identified",
    product: { name: "Pikachu", setName: "Base Set", collectorNumber: "58", language: "en", variant: null, productKind: "raw_card", gradingCompany: null, grade: null },
    confidencePercent: 97,
    prices: [{ source: "tcgdex", amountCents: 963, currency: "CHF", condition: null, updatedAt: null, convertedAmountCents: null, convertedCurrency: null }],
    hasPricing: true,
    warnings: [],
    reasonMessage: null,
    decision: null,
    dealScore: null,
    reasons: [],
    isDemo: false,
    ...overrides,
  };
}

describe("saveAnalysisResultToHistory", () => {
  beforeEach(async () => {
    await clearHistory();
  });

  it("résultat identifié : sauvegardé, retourne l'entrée créée", async () => {
    const saved = await saveAnalysisResultToHistory(view());
    expect(saved).not.toBeNull();
    expect(saved!.favorite).toBe(false);
    expect(await listHistory()).toHaveLength(1);
  });

  it("résultat identifié SANS prix (Phase 13/44) : sauvegardé quand même", async () => {
    const saved = await saveAnalysisResultToHistory(view({ prices: [], hasPricing: false }));
    expect(saved).not.toBeNull();
    expect(await listHistory()).toHaveLength(1);
  });

  it("non identifié (Phase 44 : 'network error/timeout -> no history') : jamais sauvegardé", async () => {
    const saved = await saveAnalysisResultToHistory(view({ identityStatus: "failed" }));
    expect(saved).toBeNull();
    expect(await listHistory()).toHaveLength(0);
  });

  it("doublon immédiat (Phase 44) : la première analyse est sauvegardée, la répétition immédiate ne l'est pas", async () => {
    const first = await saveAnalysisResultToHistory(view());
    expect(first).not.toBeNull();
    const second = await saveAnalysisResultToHistory(view());
    expect(second).toBeNull();
    expect(await listHistory()).toHaveLength(1);
  });
});
