import { identityQualityLabel } from "../identity-quality";

describe("identityQualityLabel", () => {
  it("absent (undefined) : null, jamais un libellé deviné", () => {
    expect(identityQualityLabel(undefined)).toBeNull();
  });

  it("barcode_confirmed -> 'Identifié par code-barres'", () => {
    expect(identityQualityLabel({ method: "barcode_confirmed", sourcesConsulted: ["wikidata"], conflicts: [] })).toBe("Identifié par code-barres");
  });

  it("lego_catalog_confirmed -> 'Catalogue LEGO confirmé'", () => {
    expect(identityQualityLabel({ method: "lego_catalog_confirmed", sourcesConsulted: ["rebrickable"], conflicts: [] })).toBe("Catalogue LEGO confirmé");
  });

  it("visual_only -> 'Identification visuelle seulement' (même quand présent explicitement, jamais confondu avec absent)", () => {
    expect(identityQualityLabel({ method: "visual_only", sourcesConsulted: [], conflicts: [] })).toBe("Identification visuelle seulement");
  });
});
