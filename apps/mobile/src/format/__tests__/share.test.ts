import { buildResultShareText } from "../share";

describe("buildResultShareText", () => {
  it("avec prix : titre + valeur marché + mention DealRadar", () => {
    const text = buildResultShareText({
      productName: "Pikachu",
      setName: "Base Set",
      collectorNumber: "58",
      marketValue: { low: 9.63, high: 9.63, currency: "CHF" },
    });
    expect(text).toContain("Pikachu — Base Set — #58");
    expect(text).toMatch(/Valeur marché/);
    expect(text).toContain("Analyse DealRadar");
  });

  it("sans prix (Phase 24 : 'ne pas inventer') : aucune ligne de prix, jamais une valeur fictive", () => {
    const text = buildResultShareText({ productName: "Pikachu", setName: "Base Set", collectorNumber: "58", marketValue: null });
    expect(text).not.toMatch(/Valeur marché/);
    expect(text).not.toMatch(/indisponible/i);
  });

  it("aucune identité connue : repli honnête, jamais une ligne vide", () => {
    const text = buildResultShareText({ productName: null, setName: null, collectorNumber: null, marketValue: null });
    expect(text.split("\n")[0]!.length).toBeGreaterThan(0);
  });
});
