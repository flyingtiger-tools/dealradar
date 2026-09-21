import { describe, expect, it, vi } from "vitest";
import { invertFxRate, resolveFxRates, resolveOneFxRate } from "../resolve-rates";
import type { FxRate, FxRateProvider } from "../types";

function fakeRate(overrides: Partial<FxRate> = {}): FxRate {
  return { baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9, rateDate: "2026-09-21", source: "test", fetchedAt: "2026-09-21T00:00:00.000Z", ...overrides };
}

describe("invertFxRate", () => {
  it("échange base/quote et inverse le taux (1/rate)", () => {
    const inverted = invertFxRate(fakeRate({ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9 }));
    expect(inverted.baseCurrency).toBe("CHF");
    expect(inverted.quoteCurrency).toBe("USD");
    expect(inverted.rate).toBeCloseTo(1 / 0.9, 10);
  });

  it("préserve rateDate/source/fetchedAt tels quels — jamais une nouvelle source de vérité", () => {
    const original = fakeRate({ rateDate: "2026-05-01", source: "frankfurter", fetchedAt: "2026-05-01T12:00:00.000Z" });
    const inverted = invertFxRate(original);
    expect(inverted.rateDate).toBe(original.rateDate);
    expect(inverted.source).toBe(original.source);
    expect(inverted.fetchedAt).toBe(original.fetchedAt);
  });
});

describe("resolveOneFxRate", () => {
  it("utilise le taux direct s'il est disponible, jamais d'inversion inutile", async () => {
    const getRate = vi.fn().mockResolvedValue(fakeRate({ baseCurrency: "USD", quoteCurrency: "CHF" }));
    const provider: FxRateProvider = { source: "test", getRate };

    const rate = await resolveOneFxRate(provider, "USD", "CHF");

    expect(rate).toEqual(fakeRate({ baseCurrency: "USD", quoteCurrency: "CHF" }));
    expect(getRate).toHaveBeenCalledTimes(1);
    expect(getRate).toHaveBeenCalledWith("USD", "CHF", undefined);
  });

  it("bascule sur la direction inverse si le fournisseur ne connaît que CHF->USD et qu'on demande USD->CHF", async () => {
    const getRate = vi.fn().mockImplementation(async (base: string, quote: string) => {
      if (base === "CHF" && quote === "USD") return fakeRate({ baseCurrency: "CHF", quoteCurrency: "USD", rate: 1.1 });
      return null;
    });
    const provider: FxRateProvider = { source: "test", getRate };

    const rate = await resolveOneFxRate(provider, "USD", "CHF");

    expect(rate).not.toBeNull();
    expect(rate!.baseCurrency).toBe("USD");
    expect(rate!.quoteCurrency).toBe("CHF");
    expect(rate!.rate).toBeCloseTo(1 / 1.1, 10);
  });

  it("aucune direction disponible -> null, jamais un taux deviné", async () => {
    const provider: FxRateProvider = { source: "test", getRate: vi.fn().mockResolvedValue(null) };
    expect(await resolveOneFxRate(provider, "USD", "CHF")).toBeNull();
  });

  it("même devise des deux côtés -> null (rien à résoudre), n'appelle jamais le fournisseur", async () => {
    const getRate = vi.fn();
    const provider: FxRateProvider = { source: "test", getRate };
    expect(await resolveOneFxRate(provider, "CHF", "CHF")).toBeNull();
    expect(getRate).not.toHaveBeenCalled();
  });
});

describe("resolveFxRates", () => {
  it("résout un taux pour chaque devise distincte demandée", async () => {
    const getRate = vi.fn().mockImplementation(async (base: string, quote: string) => fakeRate({ baseCurrency: base, quoteCurrency: quote, rate: base === "USD" ? 0.9 : 0.95 }));
    const provider: FxRateProvider = { source: "test", getRate };

    const rates = await resolveFxRates(provider, "CHF", ["USD", "EUR", "USD"]); // doublon volontaire

    expect(Object.keys(rates).sort()).toEqual(["EUR", "USD"]);
    expect(rates.USD!.rate).toBe(0.9);
    expect(rates.EUR!.rate).toBe(0.95);
  });

  it("exclut automatiquement la devise cible de la liste à résoudre", async () => {
    const getRate = vi.fn().mockResolvedValue(fakeRate());
    const provider: FxRateProvider = { source: "test", getRate };

    const rates = await resolveFxRates(provider, "CHF", ["CHF", "USD"]);

    expect(rates.CHF).toBeUndefined();
    expect(getRate).toHaveBeenCalledTimes(1); // seulement pour USD
  });

  it("une devise sans taux disponible est simplement absente du résultat, jamais une exception", async () => {
    const getRate = vi.fn().mockImplementation(async (base: string) => (base === "USD" ? fakeRate() : null));
    const provider: FxRateProvider = { source: "test", getRate };

    const rates = await resolveFxRates(provider, "CHF", ["USD", "JPY"]);

    expect(Object.keys(rates)).toEqual(["USD"]);
  });

  it("liste vide -> objet vide", async () => {
    const provider: FxRateProvider = { source: "test", getRate: vi.fn() };
    expect(await resolveFxRates(provider, "CHF", [])).toEqual({});
  });
});
