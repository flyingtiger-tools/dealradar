import { describe, expect, it, vi } from "vitest";
import { createFrankfurterProvider } from "../provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createFrankfurterProvider", () => {
  it("récupère le dernier taux disponible", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ date: "2026-07-31", base: "USD", quote: "CHF", rate: 0.9 }]));
    const provider = createFrankfurterProvider({ fetchImpl });

    const rate = await provider.getRate("USD", "CHF");

    expect(rate).not.toBeNull();
    expect(rate!.baseCurrency).toBe("USD");
    expect(rate!.quoteCurrency).toBe("CHF");
    expect(rate!.rate).toBe(0.9);
    expect(rate!.rateDate).toBe("2026-07-31");
    expect(rate!.source).toBe("frankfurter");
  });

  it("récupère un taux historique pour une date précise", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ date: "2026-07-30", base: "USD", quote: "EUR", rate: 0.86 }]));
    const provider = createFrankfurterProvider({ fetchImpl });

    const rate = await provider.getRate("USD", "EUR", "2026-07-30");

    expect(rate!.rateDate).toBe("2026-07-30");
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("date=2026-07-30");
  });

  it("retourne null si la devise demandée est absente de la réponse — jamais un taux inventé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const provider = createFrankfurterProvider({ fetchImpl });

    const rate = await provider.getRate("USD", "XYZ");

    expect(rate).toBeNull();
  });
});
