import { describe, expect, it, vi } from "vitest";
import { createIgdbCatalogConnector } from "../connector";
import { HALO_INFINITE } from "./fixtures/games";
import type { TwitchOAuthTokenProvider } from "../oauth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeTokenProvider(): TwitchOAuthTokenProvider {
  return { getAccessToken: vi.fn().mockResolvedValue("tok-123") };
}

describe("createIgdbCatalogConnector", () => {
  it("descripteur : VERROUILLÉ commercialement (allowsCommercialUse: false) — jamais présenté comme 'gratuit pour la production'", () => {
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl: vi.fn(), tokenProvider: fakeTokenProvider() });
    expect(connector.family).toBe("catalog");
    expect(connector.supportedCategorySlugs).toEqual(["gaming"]);
    expect(connector.license.allowsCommercialUse).toBe(false);
  });

  it("resolve() sans title : jamais d'appel réseau, tableau vide", async () => {
    const fetchImpl = vi.fn();
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider() });
    const matches = await connector.resolve({ categorySlug: "gaming", hints: {} });
    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolve() avec un titre : requête Apicalypse EXACTE (where name = \"...\"), jamais une recherche floue (~)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([HALO_INFINITE]));
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider() });
    const matches = await connector.resolve({ categorySlug: "gaming", hints: { title: "Halo Infinite" } });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.item.name).toBe("Halo Infinite");
    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(init.body).toContain('where name = "Halo Infinite"');
    expect(init.body).not.toContain("~");
  });

  it("resolve() échappe les guillemets dans le titre, jamais une injection Apicalypse", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider() });
    await connector.resolve({ categorySlug: "gaming", hints: { title: 'Game "Special"' } });
    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(init.body).toContain('where name = "Game \\"Special\\""');
  });

  it("resolve() aucun résultat : tableau vide, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider() });
    const matches = await connector.resolve({ categorySlug: "gaming", hints: { title: "Unknown Game XYZ" } });
    expect(matches).toEqual([]);
  });

  it("getItem() trouvé : un CatalogItem", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([HALO_INFINITE]));
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider() });
    const item = await connector.getItem("126459");
    expect(item?.name).toBe("Halo Infinite");
  });

  it("getItem() introuvable : null, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider() });
    const item = await connector.getItem("0");
    expect(item).toBeNull();
  });

  it("healthCheck() : ok quand le service répond", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider() });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("healthCheck() : down sur une panne réseau/serveur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createIgdbCatalogConnector({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider(), maxRetries: 0 });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
  });
});
