import { formatAnalysisDate } from "../date";

describe("formatAnalysisDate", () => {
  it("chaîne ISO valide : jamais affichée brute (pas de 'T'/'Z' dans le résultat)", () => {
    const formatted = formatAnalysisDate("2026-09-15T10:30:00.000Z");
    expect(formatted).not.toMatch(/T\d{2}:\d{2}/);
    expect(formatted).not.toMatch(/Z$/);
  });

  it("accepte un objet Date directement", () => {
    const formatted = formatAnalysisDate(new Date("2026-01-01T00:00:00.000Z"));
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("date invalide : repli sur la chaîne d'origine, jamais un throw ni 'Invalid Date'", () => {
    const formatted = formatAnalysisDate("pas-une-date");
    expect(formatted).not.toMatch(/invalid/i);
  });
});
