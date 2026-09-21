import { describe, expect, it } from "vitest";
import { resolveSourcesForCategory, preferredSourceNamesForCategory, CATEGORY_SOURCE_PREFERENCES } from "../source-routing";
import { emptySourceHealthState, recordSourceRun } from "../source-health-tracker";
import type { MarketSource } from "../market-source";

function fakeSource(source: string, overrides: Partial<MarketSource> = {}): MarketSource {
  return {
    source,
    displayName: source,
    supportedCategorySlugs: "any",
    evidenceTypes: ["retailPrices"],
    async search() {
      return { observations: [] };
    },
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 1 };
    },
    ...overrides,
  };
}

describe("preferredSourceNamesForCategory", () => {
  it("retourne la préférence déclarée pour une catégorie connue", () => {
    expect(preferredSourceNamesForCategory("lego")).toEqual(CATEGORY_SOURCE_PREFERENCES.lego);
  });

  it("catégorie inconnue : repli sur la préférence générique 'general', jamais un tableau vide silencieux", () => {
    expect(preferredSourceNamesForCategory("some_future_category")).toEqual(CATEGORY_SOURCE_PREFERENCES.general);
  });
});

describe("resolveSourcesForCategory", () => {
  it("ordonne les sources enregistrées selon la préférence déclarée pour la catégorie", () => {
    const sources = [fakeSource("ebay"), fakeSource("bricklink"), fakeSource("google_shopping")];
    const resolved = resolveSourcesForCategory("lego", sources);
    expect(resolved.map((s) => s.source)).toEqual(["bricklink", "ebay", "google_shopping"]);
  });

  it("aucune source obligatoire : une catégorie sans aucune source enregistrée retourne un tableau vide, jamais une exception", () => {
    expect(resolveSourcesForCategory("lego", [])).toEqual([]);
  });

  it("exclut une source qui ne déclare pas supporter la catégorie", () => {
    const sources = [fakeSource("ebay"), fakeSource("bricklink", { supportedCategorySlugs: ["watches"] })];
    const resolved = resolveSourcesForCategory("lego", sources);
    expect(resolved.map((s) => s.source)).toEqual(["ebay"]);
  });

  it("exclut une source en mauvaise santé (dernier événement = échec)", () => {
    const sources = [fakeSource("ebay"), fakeSource("bricklink")];
    let unhealthy = emptySourceHealthState("bricklink");
    unhealthy = recordSourceRun(unhealthy, { source: "bricklink", success: false, latencyMs: 100, failureReasonClass: "timeout", estimatedCostUsd: null, occurredAt: "t" });

    const resolved = resolveSourcesForCategory("lego", sources, { health: { bricklink: unhealthy } });

    expect(resolved.map((s) => s.source)).toEqual(["ebay"]);
  });

  it("une source enregistrée mais absente de la table de préférence reste utilisable si elle supporte la catégorie", () => {
    const sources = [fakeSource("ebay"), fakeSource("a_future_source")];
    const resolved = resolveSourcesForCategory("lego", sources);
    expect(resolved.map((s) => s.source)).toContain("a_future_source");
  });
});
