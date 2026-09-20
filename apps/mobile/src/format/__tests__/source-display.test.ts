import { formatSourceLabel, formatProvenanceLabel } from "../source-display";

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

describe("formatProvenanceLabel (LOT 'Données marché réelles')", () => {
  it("active_listing : phrase honnête, jamais confondue avec une vente confirmée", () => {
    expect(formatProvenanceLabel("active_listing")).toBe("Annonce active — pas une vente confirmée");
  });

  it("les 4 autres provenances connues ont un libellé dédié, jamais mis en forme comme une source marketplace", () => {
    expect(formatProvenanceLabel("sold_transaction")).toBe("Vente confirmée");
    expect(formatProvenanceLabel("market_guide")).toBe("Guide de prix");
    expect(formatProvenanceLabel("retail_price")).toBe("Prix neuf");
    expect(formatProvenanceLabel("estimated_value")).toBe("Estimation");
  });

  it("unknown ou une valeur non reconnue : null, jamais un libellé inventé", () => {
    expect(formatProvenanceLabel("unknown")).toBeNull();
    expect(formatProvenanceLabel("something_else")).toBeNull();
    expect(formatProvenanceLabel(null)).toBeNull();
  });

  it("jamais confondu avec formatSourceLabel : 'active_listing' n'est pas une source marketplace connue", () => {
    expect(formatSourceLabel("active_listing")).toBe("Active_listing"); // confirme le bogue que formatProvenanceLabel évite en étant essayé en premier
  });
});
