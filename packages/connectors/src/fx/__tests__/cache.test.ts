import { describe, expect, it, vi } from "vitest";
import { createCachedFxRateProvider } from "../cache";
import type { FxRate, FxRateProvider } from "../types";

function fakeRate(overrides: Partial<FxRate> = {}): FxRate {
  return { baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9, rateDate: "2026-09-21", source: "test", fetchedAt: "2026-09-21T00:00:00.000Z", ...overrides };
}

function fakeProvider(getRate: FxRateProvider["getRate"]): FxRateProvider {
  return { source: "underlying", getRate };
}

describe("createCachedFxRateProvider", () => {
  it("réutilise un taux mis en cache avant expiration du TTL — un seul appel au fournisseur sous-jacent", async () => {
    const getRate = vi.fn().mockResolvedValue(fakeRate());
    let time = 0;
    const cached = createCachedFxRateProvider(fakeProvider(getRate), { ttlMs: 1000, now: () => time });

    const first = await cached.getRate("USD", "CHF");
    time += 500;
    const second = await cached.getRate("USD", "CHF");

    expect(getRate).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("réinterroge le fournisseur après expiration du TTL", async () => {
    const getRate = vi.fn().mockResolvedValue(fakeRate());
    let time = 0;
    const cached = createCachedFxRateProvider(fakeProvider(getRate), { ttlMs: 1000, now: () => time });

    await cached.getRate("USD", "CHF");
    time += 1500;
    await cached.getRate("USD", "CHF");

    expect(getRate).toHaveBeenCalledTimes(2);
  });

  it("ne met jamais en cache un résultat null — retente à chaque appel", async () => {
    const getRate = vi.fn().mockResolvedValue(null);
    const cached = createCachedFxRateProvider(fakeProvider(getRate), { ttlMs: 10_000 });

    await cached.getRate("USD", "XYZ");
    await cached.getRate("USD", "XYZ");

    expect(getRate).toHaveBeenCalledTimes(2);
  });

  it("clés de cache distinctes par paire ET par date (`onDate`)", async () => {
    const getRate = vi.fn().mockResolvedValue(fakeRate());
    const cached = createCachedFxRateProvider(fakeProvider(getRate), { ttlMs: 10_000 });

    await cached.getRate("USD", "CHF");
    await cached.getRate("USD", "CHF", "2026-01-01"); // date différente -> nouvel appel
    await cached.getRate("EUR", "CHF"); // paire différente -> nouvel appel

    expect(getRate).toHaveBeenCalledTimes(3);
  });

  it("préserve le nom de source du fournisseur sous-jacent", () => {
    const cached = createCachedFxRateProvider(fakeProvider(vi.fn()));
    expect(cached.source).toBe("underlying");
  });
});
