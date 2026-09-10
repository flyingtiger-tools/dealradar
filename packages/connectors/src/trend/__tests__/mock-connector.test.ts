import { describe, expect, it } from "vitest";
import { createMockTrendSignalConnector } from "../mock-connector";
import type { TrendSignal } from "../types";

function signal(overrides: Partial<TrendSignal> = {}): TrendSignal {
  return {
    source: "reddit",
    trendDirection: "up",
    mentionVolume: 120,
    velocity: 0.3,
    sentiment: 0.4,
    confidence: 0.6,
    sourceCount: 8,
    window: "7d",
    warnings: [],
    ...overrides,
  };
}

describe("createMockTrendSignalConnector — aucune donnée réelle, aucun appel réseau", () => {
  it("retourne les signaux configurés pour n'importe quelle requête", async () => {
    const connector = createMockTrendSignalConnector("reddit", [signal()]);
    const result = await connector.fetchSignal({ categorySlug: "pokemon_tcg", hints: {}, window: "7d" });
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("reddit");
  });

  it("expose la source déclarée sur le connecteur", () => {
    const connector = createMockTrendSignalConnector("x", []);
    expect(connector.source).toBe("x");
  });

  it("aucun signal configuré : retourne un tableau vide, jamais une exception", async () => {
    const connector = createMockTrendSignalConnector("youtube", []);
    const result = await connector.fetchSignal({ categorySlug: "lego", hints: {}, window: "24h" });
    expect(result).toEqual([]);
  });
});
