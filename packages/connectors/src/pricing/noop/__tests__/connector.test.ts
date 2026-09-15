import { describe, expect, it } from "vitest";
import { createNoopPricingConnector } from "../connector";

describe("createNoopPricingConnector", () => {
  it("lookup() retourne toujours [], jamais une observation inventée", async () => {
    const connector = createNoopPricingConnector("justtcg", "clé absente");
    const result = await connector.lookup({ categorySlug: "pokemon_tcg", hints: { name: "Pikachu" } });
    expect(result).toEqual([]);
  });

  it("expose la source demandée et un coût 'free' — jamais présenté comme une vraie source active", async () => {
    const connector = createNoopPricingConnector("justtcg", "JUSTTCG_API_KEY absent");
    expect(connector.source).toBe("justtcg");
    expect(connector.cost.model).toBe("free");
    expect(connector.declaredQuality.confidence).toBe(0);
  });

  it("healthCheck() rapporte 'degraded' avec la raison fournie, jamais 'ok'", async () => {
    const connector = createNoopPricingConnector("justtcg", "JUSTTCG_API_KEY absent — source ignorée.");
    const health = await connector.healthCheck();
    expect(health.status).toBe("degraded");
    expect(health.message).toBe("JUSTTCG_API_KEY absent — source ignorée.");
  });
});
