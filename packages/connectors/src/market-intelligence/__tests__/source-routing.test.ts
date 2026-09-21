import { describe, expect, it } from "vitest";
import { resolveSourcesForCategory, orderedCandidateSourcesForCategory, preferredSourceNamesForCategory, costClassForSource, CATEGORY_SOURCE_PREFERENCES } from "../source-routing";
import { emptySourceHealthState, disableSource, recordSourceRun } from "../source-health-tracker";
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

  it("maxSourceCount tronque la LISTE DÉJÀ TRIÉE par préférence, jamais un réordonnancement", () => {
    const sources = [fakeSource("ebay"), fakeSource("bricklink"), fakeSource("google_shopping")];
    const resolved = resolveSourcesForCategory("lego", sources, { maxSourceCount: 2 });
    expect(resolved.map((s) => s.source)).toEqual(["bricklink", "ebay"]); // les 2 premières dans l'ordre de préférence lego
  });

  it("maxCostClass exclut une source plus chère que le plafond (ricardo = high_cost)", () => {
    const sources = [fakeSource("bricklink"), fakeSource("ricardo")];
    const resolved = resolveSourcesForCategory("lego", sources, { maxCostClass: "cheap" });
    expect(resolved.map((s) => s.source)).toEqual(["bricklink"]);
  });

  it("maxCostClass='high_cost' (le plus permissif) n'exclut rien", () => {
    const sources = [fakeSource("bricklink"), fakeSource("ricardo")];
    const resolved = resolveSourcesForCategory("lego", sources, { maxCostClass: "high_cost" });
    expect(resolved.map((s) => s.source).sort()).toEqual(["bricklink", "ricardo"]);
  });

  it("aucun plafond fourni : comportement inchangé (rétrocompatible)", () => {
    const sources = [fakeSource("bricklink"), fakeSource("ricardo"), fakeSource("ebay")];
    const resolved = resolveSourcesForCategory("lego", sources);
    expect(resolved.map((s) => s.source)).toEqual(["bricklink", "ebay", "ricardo"]);
  });
});

describe("costClassForSource", () => {
  it("source connue -> sa classe déclarée", () => {
    expect(costClassForSource("ebay")).toBe("free");
    expect(costClassForSource("pricecharting")).toBe("cheap");
    expect(costClassForSource("keepa")).toBe("paid");
    expect(costClassForSource("ricardo")).toBe("high_cost");
  });

  it("source inconnue -> 'paid' par défaut, jamais supposée gratuite", () => {
    expect(costClassForSource("some_future_source")).toBe("paid");
  });
});

describe("orderedCandidateSourcesForCategory", () => {
  it("produit exactement le même ordre que resolveSourcesForCategory SANS plafond — une seule logique d'ordonnancement partagée", () => {
    const sources = [fakeSource("ricardo"), fakeSource("bricklink"), fakeSource("ebay")];
    const ordered = orderedCandidateSourcesForCategory("lego", sources);
    const resolved = resolveSourcesForCategory("lego", sources);
    expect(ordered.map((s) => s.source)).toEqual(resolved.map((s) => s.source));
  });

  it("respecte la santé déclarée, comme resolveSourcesForCategory", () => {
    const unhealthy = disableSource(emptySourceHealthState("ebay"));
    const sources = [fakeSource("ebay")];
    const ordered = orderedCandidateSourcesForCategory("lego", sources, { ebay: unhealthy });
    expect(ordered).toEqual([]);
  });
});
