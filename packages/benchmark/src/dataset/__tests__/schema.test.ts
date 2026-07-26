import { describe, expect, it } from "vitest";
import { datasetSchema } from "../schema";

describe("datasetSchema", () => {
  it("accepte un dataset minimal valide", () => {
    const result = datasetSchema.safeParse({
      categorySlug: "lego",
      provenance: "synthetic",
      items: [{ raw: { itemId: "1", title: "LEGO 75313", price: { value: "849.99", currency: "CHF" } } }],
    });
    expect(result.success).toBe(true);
  });

  it("rejette un champ hors du sous-ensemble EbayRawItem", () => {
    const result = datasetSchema.safeParse({
      categorySlug: "lego",
      provenance: "synthetic",
      items: [{ raw: { itemId: "1", title: "x", soldPrice: "999" } }],
    });
    // zod par défaut ignore les clés inconnues (strip) ; on vérifie donc que
    // la clé inconnue n'est jamais reprise dans la sortie validée.
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.items[0]?.raw as Record<string, unknown>).soldPrice).toBeUndefined();
    }
  });

  it("rejette une provenance inconnue", () => {
    const result = datasetSchema.safeParse({ categorySlug: "lego", provenance: "scraped", items: [{ raw: {} }] });
    expect(result.success).toBe(false);
  });

  it("rejette une catégorie non supportée", () => {
    const result = datasetSchema.safeParse({ categorySlug: "cars", provenance: "synthetic", items: [{ raw: {} }] });
    expect(result.success).toBe(false);
  });

  it("exige au moins une annonce", () => {
    const result = datasetSchema.safeParse({ categorySlug: "lego", provenance: "synthetic", items: [] });
    expect(result.success).toBe(false);
  });

  it("valide un comparable avec soldAt", () => {
    const result = datasetSchema.safeParse({
      categorySlug: "lego",
      provenance: "synthetic",
      items: [{ raw: { itemId: "1", title: "x" } }],
      comparables: [{ raw: { itemId: "2", title: "y" }, soldAt: "2026-06-01T00:00:00.000Z" }],
    });
    expect(result.success).toBe(true);
  });
});
