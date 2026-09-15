import { formatSourceLabel } from "../source-display";

describe("formatSourceLabel", () => {
  it("source connue : nom lisible dédié", () => {
    expect(formatSourceLabel("tcgdex")).toBe("TCGdex");
    expect(formatSourceLabel("cardmarket")).toBe("Cardmarket");
  });

  it("source inconnue : jamais masquée, juste mise en forme", () => {
    expect(formatSourceLabel("nouvelle_source")).toBe("Nouvelle_source");
  });

  it("source absente : null, jamais un texte technique de repli", () => {
    expect(formatSourceLabel(null)).toBeNull();
    expect(formatSourceLabel("")).toBeNull();
  });
});
