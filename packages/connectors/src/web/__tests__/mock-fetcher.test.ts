import { describe, expect, it } from "vitest";
import { createMockWebMarketplaceFetcher } from "../mock-fetcher";
import { WebFetchError } from "../types";

describe("createMockWebMarketplaceFetcher — aucun accès réseau réel", () => {
  it("retourne la réponse configurée pour l'URL demandée", async () => {
    const fetcher = createMockWebMarketplaceFetcher({
      "https://ricardo.ch/item/1": { status: 200, body: "<html></html>", fetchedAt: "2026-01-01T00:00:00.000Z", latencyMs: 42 },
    });
    const result = await fetcher.fetch({ url: "https://ricardo.ch/item/1" });
    expect(result.status).toBe(200);
    expect(result.body).toBe("<html></html>");
  });

  it("URL non configurée : lève WebFetchError, jamais un appel réseau réel implicite", async () => {
    const fetcher = createMockWebMarketplaceFetcher({});
    await expect(fetcher.fetch({ url: "https://ricardo.ch/unknown" })).rejects.toBeInstanceOf(WebFetchError);
  });

  it("peut simuler un blocage anti-bot explicitement", async () => {
    const fetcher = createMockWebMarketplaceFetcher({
      "https://anibis.ch/item/1": new WebFetchError("Mur anti-bot détecté.", { blocked: true }),
    });
    await expect(fetcher.fetch({ url: "https://anibis.ch/item/1" })).rejects.toMatchObject({ blocked: true });
  });
});
