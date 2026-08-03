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

describe("createPokemonTcgCatalogConnector — stratégie de second essai (zéro de tête)", () => {
  const CARD_NUMBER_96: import("../raw-types").PokemonTcgRawCard = {
    id: "test-96",
    name: "Sacred Ash",
    number: "96",
    set: { id: "xy2", name: "Flashfire" },
  };

  function requestUrl(fetchImpl: ReturnType<typeof vi.fn>, callIndex: number): string {
    const arg = fetchImpl.mock.calls[callIndex]![0] as string | URL;
    return arg.toString();
  }

  it("096/094 → 096 (déjà réduit en amont) : premier essai avec le zéro de tête conservé, jamais retiré d'emblée", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ data: [] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    await connector.resolve({ categorySlug: "pokemon_tcg", hints: { name: "Nymble", collectorNumber: "096" } });

    expect(requestUrl(fetchImpl, 0)).toContain(encodeURIComponent("number:096"));
  });

  it("096 sans résultat → second essai avec le zéro de tête retiré (96), jamais une autre transformation", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [CARD_NUMBER_96] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: { name: "Sacred Ash", collectorNumber: "096" } });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestUrl(fetchImpl, 0)).toContain(encodeURIComponent("number:096"));
    expect(requestUrl(fetchImpl, 1)).toContain(encodeURIComponent("number:96"));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.item.externalId).toBe("test-96");
  });

  it("premier essai avec résultat : aucun second essai, même si le numéro porte un zéro de tête", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [CARD_NUMBER_96] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: { collectorNumber: "096" } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(matches).toHaveLength(1);
  });

  it("premier essai sans résultat et sans zéro de tête : aucun second essai (rien à retirer)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: { collectorNumber: "96" } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(matches).toEqual([]);
  });

  it("numéro promo/alphanumérique (SWSH001) sans résultat : aucun second essai, jamais modifié", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    await connector.resolve({ categorySlug: "pokemon_tcg", hints: { collectorNumber: "SWSH001" } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestUrl(fetchImpl, 0)).toContain(encodeURIComponent("number:SWSH001"));
  });

  it("second essai sans résultat non plus : retourne une liste vide proprement, jamais un troisième essai", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ data: [] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: { collectorNumber: "007" } });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(matches).toEqual([]);
  });

  it("un collectorNumber qui contient encore un slash (format non reconnu en amont) n'est jamais envoyé à Lucene", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    await connector.resolve({ categorySlug: "pokemon_tcg", hints: { name: "Test", collectorNumber: "TG05/TG30" } });

    const url = requestUrl(fetchImpl, 0);
    expect(url).not.toMatch(/number.*(%2F|\/)/);
    expect(url).toContain(encodeURIComponent('name:"Test"'));
  });

  it("non-régression : recherche existante sans zéro de tête et avec résultat direct fonctionne comme avant", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [CHARIZARD_GYM2_CARD] }));
    const connector = createPokemonTcgCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({
      categorySlug: "pokemon_tcg",
      hints: { name: "Blaine's Charizard", setName: "Gym Challenge", collectorNumber: "2" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(matches[0]!.item.externalId).toBe("gym2-2");
    expect(matches[0]!.confidence).toBe(1);
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
