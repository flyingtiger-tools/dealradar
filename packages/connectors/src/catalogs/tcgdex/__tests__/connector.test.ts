import { describe, expect, it, vi } from "vitest";
import { createTcgdexCatalogConnector } from "../connector";
import { PIKACHU_BASE1_EN, PIKACHU_BASE1_FR } from "./fixtures/cards";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createTcgdexCatalogConnector — descripteur", () => {
  it("déclare la famille catalog et la capacité versionnée catalog.resolve.v1", () => {
    const connector = createTcgdexCatalogConnector({ fetchImpl: vi.fn() });
    expect(connector.family).toBe("catalog");
    expect(connector.capabilities).toEqual(["catalog.resolve.v1"]);
    expect(connector.source).toBe("tcgdex");
  });

  it("déclare allowsCommercialUse: true — licence MIT confirmée (github.com/tcgdex/cards-database)", () => {
    const connector = createTcgdexCatalogConnector({ fetchImpl: vi.fn() });
    expect(connector.license.allowsCommercialUse).toBe(true);
  });
});

describe("createTcgdexCatalogConnector — resolve()", () => {
  it("carte anglaise exacte : recherche puis détail, résolue avec confiance maximale", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "base1-58", localId: "58", name: "Pikachu" }]))
      .mockResolvedValueOnce(jsonResponse(PIKACHU_BASE1_EN));
    const connector = createTcgdexCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({
      categorySlug: "pokemon_tcg",
      hints: { name: "Pikachu", setName: "Base Set", setCode: "base1", collectorNumber: "58", language: "en" },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]!.item.externalId).toBe("base1-58");
    expect(matches[0]!.confidence).toBe(1);
    const [firstUrl] = fetchImpl.mock.calls[0]!;
    expect(String(firstUrl)).toContain("/v2/en/cards");
  });

  it("carte française exacte : interroge la locale fr, résolue avec confiance maximale", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "base1-58", localId: "58", name: "Pikachu" }]))
      .mockResolvedValueOnce(jsonResponse(PIKACHU_BASE1_FR));
    const connector = createTcgdexCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({
      categorySlug: "pokemon_tcg",
      hints: { name: "Pikachu", setName: "Set de Base", setCode: "base1", collectorNumber: "58", language: "fr" },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]!.confidence).toBe(1);
    const [firstUrl] = fetchImpl.mock.calls[0]!;
    expect(String(firstUrl)).toContain("/v2/fr/cards");
  });

  it("refuse honnêtement de résoudre un produit scellé (aucun appel réseau)", async () => {
    const fetchImpl = vi.fn();
    const connector = createTcgdexCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: { kind: "booster_pack", name: "Base Set Booster Pack" } });
    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retourne une liste vide sans indice exploitable, sans appeler l'API", async () => {
    const fetchImpl = vi.fn();
    const connector = createTcgdexCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: {} });
    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignore un détail au payload invalide plutôt que de planter toute la recherche", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "bad-id", localId: "1", name: "Broken" }]))
      .mockResolvedValueOnce(jsonResponse({ not: "a valid card" }));
    const connector = createTcgdexCatalogConnector({ fetchImpl });

    const matches = await connector.resolve({ categorySlug: "pokemon_tcg", hints: { name: "Broken" } });
    expect(matches).toEqual([]);
  });
});

describe("createTcgdexCatalogConnector — healthCheck()", () => {
  it("rapporte 'ok' quand l'API répond", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const connector = createTcgdexCatalogConnector({ fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("rapporte 'down' proprement quand l'API échoue", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createTcgdexCatalogConnector({ fetchImpl, maxRetries: 0 });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
  });
});
