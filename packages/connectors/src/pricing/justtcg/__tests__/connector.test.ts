import { describe, expect, it, vi } from "vitest";
import { createJustTcgPricingConnector } from "../connector";
import { PIKACHU_RAW_CARD, CHARIZARD_GRADED_CARD, AMBIGUOUS_NAME_CARDS } from "./fixtures/cards";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createJustTcgPricingConnector — descripteur", () => {
  it("déclare la famille pricing et la capacité versionnée pricing.lookup.v1, rien d'autre", () => {
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl: vi.fn() });
    expect(connector.family).toBe("pricing");
    expect(connector.capabilities).toEqual(["pricing.lookup.v1"]);
    expect(connector.source).toBe("justtcg");
  });

  it("déclare allowsCommercialUse: true — confirmé par écrit dans les CGU JustTCG", () => {
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl: vi.fn() });
    expect(connector.license.allowsCommercialUse).toBe(true);
    expect(connector.license.allowsRedistribution).toBe(false);
  });
});

describe("createJustTcgPricingConnector — lookup()", () => {
  it("carte brute avec correspondance exacte", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [PIKACHU_RAW_CARD] }));
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl });

    const results = await connector.lookup({
      categorySlug: "pokemon_tcg",
      hints: { name: "Pikachu", setCode: "base4", collectorNumber: "58" },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.source === "justtcg")).toBe(true);
    expect(results.every((r) => r.priceType === "market_aggregate")).toBe(true);
  });

  it("ne transmet jamais setCode comme filtre `set` à l'API — id de catalogue d'origine, pas le slug interne JustTCG (confirmé par appel réel)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [PIKACHU_RAW_CARD] }));
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl });

    await connector.lookup({ categorySlug: "pokemon_tcg", hints: { name: "Pikachu", setCode: "base4", collectorNumber: "58" } });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain("set=base4");
    expect(String(url)).not.toMatch(/[?&]set=/);
  });

  it("carte gradée avec société et note exactes — n'appelle l'API qu'en mode gradé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [CHARIZARD_GRADED_CARD] }));
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl });

    await connector.lookup({
      categorySlug: "pokemon_tcg",
      hints: { name: "Charizard", gradingCompany: "PSA", grade: "10" },
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain("graded=only");
    expect(url).toContain("grading_company=PSA");
    void init;
  });

  it("nom seul ambigu — retourne toutes les cartes candidates avec confiance réduite, jamais un choix arbitraire", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: AMBIGUOUS_NAME_CARDS }));
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl });

    const results = await connector.lookup({ categorySlug: "pokemon_tcg", hints: { name: "Charizard" } });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.confidence <= 0.5)).toBe(true);
    expect(results.every((r) => r.warnings.some((w) => w.includes("ambigu")))).toBe(true);
  });

  it("refuse honnêtement tout kind scellé — aucun appel réseau, aucun produit scellé inventé", async () => {
    const fetchImpl = vi.fn();
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl });
    const sealedKinds = ["booster_pack", "display_box", "elite_trainer_box", "tin", "collection_box", "bundle", "sealed_product", "lot"] as const;

    for (const kind of sealedKinds) {
      const results = await connector.lookup({ categorySlug: "pokemon_tcg", hints: { kind, name: "Base Set Booster Box" } });
      expect(results).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retourne une liste vide sans indice exploitable, sans appeler l'API", async () => {
    const fetchImpl = vi.fn();
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl });
    const results = await connector.lookup({ categorySlug: "pokemon_tcg", hints: {} });
    expect(results).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("payload invalide — lève une ConnectorError non-retryable plutôt que de renvoyer des données non fiables", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "x" }] })); // carte sans name/game/set/number/variants
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl });

    await expect(connector.lookup({ categorySlug: "pokemon_tcg", hints: { name: "Pikachu" } })).rejects.toMatchObject({
      name: "ConnectorError",
      retryable: false,
    });
  });

  it("erreur 429 — propage une ConnectorError retryable après épuisement des tentatives", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl, maxRetries: 0 });
    await expect(connector.lookup({ categorySlug: "pokemon_tcg", hints: { name: "Pikachu" } })).rejects.toMatchObject({
      httpStatus: 429,
      retryable: true,
    });
  });

  it("erreur 500 — propage une ConnectorError retryable après épuisement des tentatives", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl, maxRetries: 0 });
    await expect(connector.lookup({ categorySlug: "pokemon_tcg", hints: { name: "Pikachu" } })).rejects.toMatchObject({
      httpStatus: 500,
      retryable: true,
    });
  });
});

describe("createJustTcgPricingConnector — healthCheck()", () => {
  it("rapporte 'ok' quand l'API répond", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const connector = createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("rapporte 'down' proprement quand l'API échoue, sans fuiter la clé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createJustTcgPricingConnector({ apiKey: "super-secret", fetchImpl, maxRetries: 0 });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
    expect(health.message).not.toContain("super-secret");
  });
});
