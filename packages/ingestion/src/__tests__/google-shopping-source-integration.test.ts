import { describe, expect, it, vi } from "vitest";
import { createGoogleShoppingConnector, resolveSourcesForCategory } from "@dealradar/connectors";
import { aggregateMarketObservations } from "../aggregate-market-observations";

/**
 * LOT "Multi-Source Fusion + Source Wave 1", section 4 — preuve que Google
 * Shopping (connecteur construit lors du lot précédent, jamais modifié ici)
 * traverse réellement le chemin d'orchestration commun : table de
 * préférence par catégorie (`source-routing.ts`) -> agrégateur multi-source
 * (`aggregate-market-observations.ts`) -> `MarketObservation[]` canonique.
 * `SERPAPI_KEY` est ABSENT en local (voir audit de credentials du lot) —
 * ce test utilise un `fetchImpl` factice, jamais un appel réseau réel.
 */
function fakeFetch(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

describe("Google Shopping — intégration source-routing + aggregate-market-observations", () => {
  it("résolu pour une catégorie où il est préféré (apple), interrogé par l'agrégateur, normalisé en MarketObservation", async () => {
    const fetchImpl = fakeFetch({
      shopping_results: [
        { title: "iPhone 13 128GB", product_id: "gs-1", product_link: "https://example.com/1", extracted_price: 450, position: 1 },
        { title: "iPhone 13 128GB reconditionné", product_id: "gs-2", product_link: "https://example.com/2", extracted_price: 380, second_hand_condition: "used", position: 2 },
      ],
    });
    const googleShopping = createGoogleShoppingConnector({ apiKey: "test-key", fetchImpl });

    const resolved = resolveSourcesForCategory("apple", [googleShopping]);
    expect(resolved.map((s) => s.source)).toEqual(["google_shopping"]);

    const result = await aggregateMarketObservations({ categorySlug: "apple", sources: resolved, q: "iphone 13 128gb", country: "ch" });

    expect(result.diagnostics).toEqual([{ source: "google_shopping", status: "success", observationCount: 2, latencyMs: expect.any(Number) }]);
    expect(result.observations).toHaveLength(2);

    const retail = result.observations.find((o) => o.sourceItemId === "gs-1")!;
    expect(retail.evidenceType).toBe("retailPrices");
    expect(retail.evidenceTier).toBe("E");
    expect(retail.soldAt).toBeNull();

    const secondHand = result.observations.find((o) => o.sourceItemId === "gs-2")!;
    expect(secondHand.evidenceType).toBe("activeListings");
    expect(secondHand.evidenceTier).toBe("D");
    expect(secondHand.soldAt).toBeNull();
  });

  it("catégorie sans Google Shopping dans les préférences déclarées mais source enregistrée + 'any' catégorie supportée : reste résolue (jamais ignorée silencieusement)", async () => {
    const fetchImpl = fakeFetch({ shopping_results: [] });
    const googleShopping = createGoogleShoppingConnector({ apiKey: "test-key", fetchImpl });

    // "lego" a bricklink/ebay en tête de liste mais google_shopping y figure aussi (préférence déclarée) — on vérifie ici le cas d'une catégorie SANS entrée dédiée du tout.
    const resolved = resolveSourcesForCategory("unlisted_category", [googleShopping]);
    expect(resolved.map((s) => s.source)).toEqual(["google_shopping"]);
  });

  it("une panne SerpApi (erreur explicite dans la réponse) est un diagnostic 'error' isolé, jamais une exception qui casse l'agrégation", async () => {
    const fetchImpl = fakeFetch({ error: "quota dépassé" });
    const googleShopping = createGoogleShoppingConnector({ apiKey: "test-key", fetchImpl });

    const resolved = resolveSourcesForCategory("apple", [googleShopping]);
    const result = await aggregateMarketObservations({ categorySlug: "apple", sources: resolved, q: "iphone" });

    expect(result.observations).toEqual([]);
    expect(result.diagnostics[0]?.status).toBe("error");
    expect(result.diagnostics[0]?.errorMessage).toContain("quota dépassé");
  });
});
