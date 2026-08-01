import { describe, expect, it, vi } from "vitest";
import { createPokemonTcgCatalogConnector } from "../connector";
import { PIKACHU_PROMO_CARD, CHARIZARD_GYM2_CARD } from "./fixtures/cards";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createPokemonTcgCatalogConnector — descripteur", () => {
  it("déclare la famille catalog et la capacité versionnée catalog.resolve.v1, rien d'autre", () => {
    const connector = createPokemonTcgCatalogConnector({ fetchImpl: vi.fn() });
    expect(connector.family).toBe("catalog");
    expect(connector.capabilities).toEqual(["catalog.resolve.v1"]);
    expect(connector.source).toBe("pokemon-tcg-api");
  });

  it("déclare allowsCommercialUse: false — non confirmé, jamais une permission supposée", () => {
    const connector = createPokemonTcgCatalogConnector({ fetchImpl: vi.fn() });
    expect(connector.license.allowsCommercialUse).toBe(false);
  });
});

describe("createPokemonTcgCatalogConnector — resolve()", () => {
  it("résout une carte réelle par nom+set+numéro avec confiance maximale", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [CHARIZARD_GYM2_CARD] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({
      categorySlug: "pokemon_tcg",
      hints: { kind: "raw_card", name: "Blaine's Charizard", setName: "Gym Challenge", collectorNumber: "2" },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]!.item.externalId).toBe("gym2-2");
    expect(matches[0]!.confidence).toBe(1);
    expect(matches[0]!.item.categorySlug).toBe("pokemon_tcg");
  });

  it("trie les correspondances par confiance décroissante", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [PIKACHU_PROMO_CARD, CHARIZARD_GYM2_CARD] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({
      categorySlug: "pokemon_tcg",
      hints: { name: "Blaine's Charizard", collectorNumber: "2" },
    });

    expect(matches[0]!.item.externalId).toBe("gym2-2");
  });

  it("refuse honnêtement de résoudre un produit scellé (aucun appel réseau, aucune correspondance devinée)", async () => {
    const fetchImpl = vi.fn();
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({
      categorySlug: "pokemon_tcg",
      hints: { kind: "booster_pack", name: "Base Set Booster Pack" },
    });

    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuse honnêtement tous les kinds scellés listés (display, ETB, tin, coffret, bundle, lot)", async () => {
    const fetchImpl = vi.fn();
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });
    const sealedKinds = [
      "display_box",
      "elite_trainer_box",
      "tin",
      "collection_box",
      "bundle",
      "sealed_product",
      "lot",
      "graded_card",
    ] as const;

    for (const kind of sealedKinds) {
      const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: { kind, name: "Charizard" } });
      expect(matches).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retourne une liste vide sans indice exploitable, sans appeler l'API", async () => {
    const fetchImpl = vi.fn();
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: {} });
    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createPokemonTcgCatalogConnector — getItem()", () => {
  it("récupère une carte par identifiant externe stable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: PIKACHU_PROMO_CARD }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });
    const item = await connector.getItem("basep-1");
    expect(item?.externalId).toBe("basep-1");
    expect(item?.name).toBe("Pikachu");
  });

  it("retourne null proprement sur 404, jamais une exception qui casse l'appelant", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });
    await expect(connector.getItem("unknown-id")).resolves.toBeNull();
  });
});

describe("createPokemonTcgCatalogConnector — healthCheck()", () => {
  it("rapporte 'ok' quand l'API répond", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("rapporte 'down' proprement quand l'API échoue", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl, maxRetries: 0 });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
  });
});
