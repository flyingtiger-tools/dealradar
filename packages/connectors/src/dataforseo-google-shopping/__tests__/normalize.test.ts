import { describe, expect, it } from "vitest";
import { normalizeDataForSeoShoppingItem, normalizeDataForSeoTaskResult } from "../normalize";
import type { DataForSeoShoppingItem } from "../raw-types";

const CONTEXT = { categorySlug: "apple", query: "iphone 13 128gb", country: "ch", collectedAt: "2026-09-21T00:00:00.000Z" };

function rawItem(overrides: Partial<DataForSeoShoppingItem> = {}): DataForSeoShoppingItem {
  return {
    type: "google_shopping_serp",
    title: "iPhone 13 128GB",
    price: 450,
    currency: "CHF",
    seller: "Fnac",
    domain: "fnac.ch",
    product_id: "gp-1",
    shopping_url: "https://google.com/shopping/1",
    rank_absolute: 1,
    ...overrides,
  };
}

describe("normalizeDataForSeoShoppingItem", () => {
  it("normalise un résultat complet -> retailPrices, palier E", () => {
    const observation = normalizeDataForSeoShoppingItem(rawItem(), CONTEXT);
    expect(observation).not.toBeNull();
    expect(observation!.evidenceType).toBe("retailPrices");
    expect(observation!.evidenceTier).toBe("E");
    expect(observation!.priceAmountCents).toBe(45000);
    expect(observation!.currency).toBe("CHF");
  });

  it("marketplace = domain du marchand réel (jamais 'dataforseo_google_shopping' quand connu) — clé pour le dédoublonnage inter-fournisseurs", () => {
    const observation = normalizeDataForSeoShoppingItem(rawItem({ domain: "digitec.ch" }), CONTEXT);
    expect(observation!.marketplace).toBe("digitec.ch");
  });

  it("repli sur seller si domain absent", () => {
    const observation = normalizeDataForSeoShoppingItem(rawItem({ domain: undefined, seller: "Fnac" }), CONTEXT);
    expect(observation!.marketplace).toBe("Fnac");
  });

  it("condition toujours null — cet endpoint ne documente aucun signal de condition, jamais deviné", () => {
    const observation = normalizeDataForSeoShoppingItem(rawItem(), CONTEXT);
    expect(observation!.condition).toBeNull();
  });

  it("jamais soldTransactions ni soldAt renseigné", () => {
    const observation = normalizeDataForSeoShoppingItem(rawItem(), CONTEXT);
    expect(observation!.evidenceType).not.toBe("soldTransactions");
    expect(observation!.soldAt).toBeNull();
  });

  it("sans titre/prix/devise exploitable -> null, jamais une valeur inventée", () => {
    expect(normalizeDataForSeoShoppingItem(rawItem({ title: undefined }), CONTEXT)).toBeNull();
    expect(normalizeDataForSeoShoppingItem(rawItem({ price: undefined }), CONTEXT)).toBeNull();
    expect(normalizeDataForSeoShoppingItem(rawItem({ currency: undefined }), CONTEXT)).toBeNull();
  });

  it("préserve googleProductId dans identifiers quand connu", () => {
    const observation = normalizeDataForSeoShoppingItem(rawItem({ product_id: "gp-42" }), CONTEXT);
    expect(observation!.identifiers).toEqual({ googleProductId: "gp-42" });
  });
});

describe("normalizeDataForSeoTaskResult", () => {
  it("normalise plusieurs items d'un même résultat de tâche", () => {
    const observations = normalizeDataForSeoTaskResult({ items: [rawItem({ product_id: "a" }), rawItem({ product_id: "b" })] }, CONTEXT);
    expect(observations).toHaveLength(2);
  });

  it("items absent -> tableau vide, jamais une exception", () => {
    expect(normalizeDataForSeoTaskResult({}, CONTEXT)).toEqual([]);
  });
});
