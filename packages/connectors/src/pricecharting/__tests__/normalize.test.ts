import { describe, expect, it } from "vitest";
import { normalizePriceChartingProduct } from "../normalize";
import type { PriceChartingProductResponse } from "../raw-types";

const CONTEXT = { categorySlug: "gaming", query: "super mario 64", collectedAt: "2026-09-21T00:00:00.000Z" };

function rawProduct(overrides: Partial<PriceChartingProductResponse> = {}): PriceChartingProductResponse {
  return {
    id: "6910",
    "product-name": "Super Mario 64",
    "console-name": "Nintendo 64",
    "loose-price": 2500,
    "cib-price": 4500,
    "new-price": 25000,
    "graded-price": 80000,
    ...overrides,
  };
}

describe("normalizePriceChartingProduct", () => {
  it("produit jusqu'à 4 observations distinctes (loose/CIB/neuf/gradé), toutes Tier B", () => {
    const observations = normalizePriceChartingProduct(rawProduct(), CONTEXT);
    expect(observations).toHaveLength(4);
    expect(observations.every((o) => o.evidenceTier === "B")).toBe(true);
    expect(observations.every((o) => o.evidenceType === "historicalPrices")).toBe(true);
  });

  it("jamais soldTransactions ni soldAt renseigné — valeur calculée, pas une vente confirmée", () => {
    const observations = normalizePriceChartingProduct(rawProduct(), CONTEXT);
    expect(observations.every((o) => o.evidenceType !== "soldTransactions")).toBe(true);
    expect(observations.every((o) => o.soldAt === null)).toBe(true);
  });

  it("distingue loose/complete_in_box/sealed/graded via completeness, jamais fusionnés", () => {
    const observations = normalizePriceChartingProduct(rawProduct(), CONTEXT);
    const byCompleteness = Object.fromEntries(observations.map((o) => [o.completeness, o.priceAmountCents]));
    expect(byCompleteness.loose).toBe(2500);
    expect(byCompleteness.complete_in_box).toBe(4500);
    expect(byCompleteness.sealed).toBe(25000);
    expect(byCompleteness.graded).toBe(80000);
  });

  it("un champ de prix absent ne produit simplement aucune observation pour cette variante", () => {
    const observations = normalizePriceChartingProduct(rawProduct({ "graded-price": undefined }), CONTEXT);
    expect(observations).toHaveLength(3);
    expect(observations.find((o) => o.completeness === "graded")).toBeUndefined();
  });

  it("devise toujours USD, jamais devinée autrement (marché PriceCharting = américain)", () => {
    const observations = normalizePriceChartingProduct(rawProduct(), CONTEXT);
    expect(observations.every((o) => o.currency === "USD")).toBe(true);
  });

  it("aucun prix exploitable : tableau vide, jamais une exception", () => {
    expect(normalizePriceChartingProduct(rawProduct({ "loose-price": undefined, "cib-price": undefined, "new-price": undefined, "graded-price": undefined }), CONTEXT)).toEqual([]);
  });

  it("id absent ou statut d'erreur : tableau vide, jamais un produit inventé", () => {
    expect(normalizePriceChartingProduct(rawProduct({ id: undefined }), CONTEXT)).toEqual([]);
    expect(normalizePriceChartingProduct(rawProduct({ status: "error" }), CONTEXT)).toEqual([]);
  });
});
