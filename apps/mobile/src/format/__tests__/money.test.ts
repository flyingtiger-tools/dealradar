import { formatMoney, formatMoneyRange } from "../money";

describe("formatMoney", () => {
  it.each(["CHF", "EUR", "USD", "GBP"])("formate %s sans lever d'exception et sans exposer le format brut '${price} XXX'", (currency) => {
    const formatted = formatMoney(9.63, currency);
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toBe("9.63 " + currency);
  });

  it("devise inconnue : repli lisible, jamais un throw", () => {
    expect(() => formatMoney(10, "XXX")).not.toThrow();
  });
});

describe("formatMoneyRange", () => {
  it("low === high : une seule valeur affichée, pas une fourchette redondante", () => {
    const formatted = formatMoneyRange(9.63, 9.63, "CHF");
    expect(formatted).not.toMatch(/–/);
  });

  it("low !== high : une fourchette avec les deux valeurs", () => {
    const formatted = formatMoneyRange(5, 10, "EUR");
    expect(formatted).toMatch(/–/);
  });
});
