import { describe, expect, it, vi } from "vitest";
import { createOpenExchangeRatesProvider } from "../provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createOpenExchangeRatesProvider", () => {
  it("récupère le dernier taux disponible (/latest.json)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ base: "USD", timestamp: 1785500000, rates: { CHF: 0.91 } }));
    const provider = createOpenExchangeRatesProvider({ appId: "test", fetchImpl });

    const rate = await provider.getRate("USD", "CHF");

    expect(rate).not.toBeNull();
    expect(rate!.baseCurrency).toBe("USD");
    expect(rate!.quoteCurrency).toBe("CHF");
    expect(rate!.rate).toBe(0.91);
    expect(rate!.source).toBe("openexchangerates");
    expect(rate!.rateDate).toBe(new Date(1785500000 * 1000).toISOString().slice(0, 10));
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/latest.json");
  });

  it("récupère un taux historique pour une date précise (/historical/{date}.json)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ base: "USD", timestamp: 1753900800, rates: { EUR: 0.86 } }));
    const provider = createOpenExchangeRatesProvider({ appId: "test", fetchImpl });

    const rate = await provider.getRate("USD", "EUR", "2026-07-30");

    expect(rate!.rateDate).toBe("2026-07-30");
    expect(rate!.rate).toBe(0.86);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/historical/2026-07-30.json");
  });

  it("retourne null si la devise demandée est absente de la réponse — jamais un taux inventé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ base: "USD", timestamp: 1785500000, rates: {} }));
    const provider = createOpenExchangeRatesProvider({ appId: "test", fetchImpl });

    const rate = await provider.getRate("USD", "XYZ");

    expect(rate).toBeNull();
  });
});
