import { describe, expect, it } from "vitest";
import { estimateCostUsd, findCostTableEntry } from "../cost-table";

describe("cost-table", () => {
  it("trouve l'entrée GPT-4o-mini", () => {
    const entry = findCostTableEntry("openai", "gpt-4o-mini");
    expect(entry).not.toBeNull();
  });

  it("retourne null pour un provider/modèle non répertorié plutôt qu'un tarif inventé", () => {
    expect(findCostTableEntry("anthropic", "claude-haiku-4.5")).toBeNull();
    expect(estimateCostUsd({ inputUnits: 100, outputUnits: 100 }, null)).toBeNull();
  });

  it("calcule un coût cohérent avec la table tarifaire", () => {
    const entry = findCostTableEntry("openai", "gpt-4o-mini");
    const cost = estimateCostUsd({ inputUnits: 1_000_000, outputUnits: 1_000_000 }, entry);
    expect(cost).toBeCloseTo(0.15 + 0.6, 5);
  });
});
