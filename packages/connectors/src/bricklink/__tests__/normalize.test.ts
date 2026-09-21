import { describe, expect, it } from "vitest";
import { normalizeBrickLinkPriceGuide } from "../normalize";
import type { BrickLinkPriceGuideResponse } from "../raw-types";

const CONTEXT = { categorySlug: "lego", query: "75192", guideType: "sold" as const, collectedAt: "2026-09-21T00:00:00.000Z" };

function rawResponse(overrides: Partial<BrickLinkPriceGuideResponse["data"]> = {}): BrickLinkPriceGuideResponse {
  return {
    meta: { code: 200, message: "OK" },
    data: {
      item: { no: "75192", type: "SET" },
      new_or_used: "N",
      currency_code: "CHF",
      min_price: "700.00",
      max_price: "950.00",
      avg_price: "820.00",
      qty_avg_price: "810.00",
      unit_quantity: 42,
      total_quantity: 50,
      ...overrides,
    },
  };
}

describe("normalizeBrickLinkPriceGuide — guide 'sold'", () => {
  it("produit une observation agrégée Tier B (historicalPrices), jamais Tier A", () => {
    const obs = normalizeBrickLinkPriceGuide(rawResponse(), CONTEXT);
    expect(obs).not.toBeNull();
    expect(obs?.evidenceType).toBe("historicalPrices");
    expect(obs?.evidenceTier).toBe("B");
  });

  it("soldAt reste toujours null pour un agrégat, jamais un horodatage individuel inventé", () => {
    const obs = normalizeBrickLinkPriceGuide(rawResponse(), CONTEXT);
    expect(obs?.soldAt).toBeNull();
  });

  it("préfère qty_avg_price (moyenne pondérée) à avg_price quand disponible", () => {
    const obs = normalizeBrickLinkPriceGuide(rawResponse(), CONTEXT);
    expect(obs?.priceAmountCents).toBe(81000); // 810.00 CHF
  });

  it("replie sur avg_price si qty_avg_price est absent", () => {
    const obs = normalizeBrickLinkPriceGuide(rawResponse({ qty_avg_price: undefined }), CONTEXT);
    expect(obs?.priceAmountCents).toBe(82000); // 820.00 CHF
  });

  it("conserve min/max/qty dans les métadonnées brutes, jamais perdus", () => {
    const obs = normalizeBrickLinkPriceGuide(rawResponse(), CONTEXT);
    expect(obs?.rawMetadataRef).toMatchObject({ minPrice: "700.00", maxPrice: "950.00", unitQuantity: 42, totalQuantity: 50 });
  });

  it("new_or_used='N' -> condition 'new', 'U' -> 'used'", () => {
    expect(normalizeBrickLinkPriceGuide(rawResponse({ new_or_used: "N" }), CONTEXT)?.condition).toBe("new");
    expect(normalizeBrickLinkPriceGuide(rawResponse({ new_or_used: "U" }), CONTEXT)?.condition).toBe("used");
  });
});

describe("normalizeBrickLinkPriceGuide — guide 'stock'", () => {
  it("produit une observation Tier D (activeListings), jamais A ni B", () => {
    const obs = normalizeBrickLinkPriceGuide(rawResponse(), { ...CONTEXT, guideType: "stock" });
    expect(obs?.evidenceType).toBe("activeListings");
    expect(obs?.evidenceTier).toBe("D");
    expect(obs?.soldAt).toBeNull();
  });
});

describe("normalizeBrickLinkPriceGuide — cas invalides", () => {
  it("aucun prix moyen exploitable (min/max/avg/qty_avg tous absents) : null, jamais une valeur inventée", () => {
    const obs = normalizeBrickLinkPriceGuide(rawResponse({ avg_price: undefined, qty_avg_price: undefined }), CONTEXT);
    expect(obs).toBeNull();
  });

  it("item.no absent : null", () => {
    const raw = rawResponse();
    delete raw.data!.item!.no;
    expect(normalizeBrickLinkPriceGuide(raw, CONTEXT)).toBeNull();
  });

  it("currency_code absent : null, jamais une devise devinée", () => {
    expect(normalizeBrickLinkPriceGuide(rawResponse({ currency_code: undefined }), CONTEXT)).toBeNull();
  });

  it("data absent : null, jamais une exception", () => {
    expect(normalizeBrickLinkPriceGuide({}, CONTEXT)).toBeNull();
  });
});
