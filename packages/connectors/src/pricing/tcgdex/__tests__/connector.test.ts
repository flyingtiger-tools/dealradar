import { describe, expect, it, vi } from "vitest";
import { createTcgdexPricingConnector } from "../connector";
import { PIKACHU_BASE1_EN } from "../../../catalogs/tcgdex/__tests__/fixtures/cards";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createTcgdexPricingConnector — descripteur", () => {
  it("déclare la famille pricing et la capacité versionnée pricing.lookup.v1", () => {
    const connector = createTcgdexPricingConnector({ fetchImpl: vi.fn() });
    expect(connector.family).toBe("pricing");
    expect(connector.capabilities).toEqual(["pricing.lookup.v1"]);
    expect(connector.source).toBe("tcgdex");
  });
});

describe("createTcgdexPricingConnector — lookup()", () => {
  it("retourne les observations Cardmarket EUR et TCGPlayer USD pour une carte résolue", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "base1-58", localId: "58", name: "Pikachu" }]))
      .mockResolvedValueOnce(jsonResponse(PIKACHU_BASE1_EN));
    const connector = createTcgdexPricingConnector({ fetchImpl });

    const observations = await connector.lookup({ categorySlug: "pokemon_tcg", hints: { name: "Pikachu", setCode: "base1", collectorNumber: "58" } });

    expect(observations.map((o) => o.currency).sort()).toEqual(["EUR", "EUR", "USD"]);
    expect(observations.every((o) => o.source === "tcgdex")).toBe(true);
  });

  it("retourne une liste vide sans indice exploitable, sans appeler l'API", async () => {
    const fetchImpl = vi.fn();
    const connector = createTcgdexPricingConnector({ fetchImpl });
    const observations = await connector.lookup({ categorySlug: "pokemon_tcg", hints: {} });
    expect(observations).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuse honnêtement un produit gradé (hors de portée de TCGdex)", async () => {
    const fetchImpl = vi.fn();
    const connector = createTcgdexPricingConnector({ fetchImpl });
    const observations = await connector.lookup({ categorySlug: "pokemon_tcg", hints: { kind: "graded_card", name: "Pikachu" } });
    expect(observations).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
