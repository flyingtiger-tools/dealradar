import { buildProductKey } from "../product-key";

const base = { name: "Pikachu", setName: "Base Set", collectorNumber: "58", language: "en", variant: null as string | null };

describe("buildProductKey", () => {
  it("même set + numéro + langue -> même clé, peu importe la casse/les espaces", () => {
    const a = buildProductKey("pokemon_tcg", base);
    const b = buildProductKey("pokemon_tcg", { ...base, setName: "  BASE SET ", language: "EN" });
    expect(a).toBe(b);
  });

  it("numéro de collection avec zéros de tête : '058' et '58' produisent la même clé", () => {
    const a = buildProductKey("pokemon_tcg", { ...base, collectorNumber: "058" });
    const b = buildProductKey("pokemon_tcg", { ...base, collectorNumber: "58" });
    expect(a).toBe(b);
  });

  it("numéro alphanumérique (ex. 'H23') : jamais altéré au-delà d'un trim/minuscule", () => {
    const key = buildProductKey("pokemon_tcg", { ...base, collectorNumber: "H23" });
    expect(key).toContain("h23");
  });

  it("set/variant absents : ne casse jamais, replie sur le nom normalisé", () => {
    const key = buildProductKey("pokemon_tcg", { name: "Pikachu", setName: null, collectorNumber: null, language: null, variant: null });
    expect(key).toBe("pokemon_tcg|||||pikachu");
  });

  it("set+numéro présents : le nom n'entre PAS dans la clé (deux scans avec un nom légèrement différent restent le même produit)", () => {
    const a = buildProductKey("pokemon_tcg", { ...base, name: "Pikachu" });
    const b = buildProductKey("pokemon_tcg", { ...base, name: "pikachu (extraction incertaine)" });
    expect(a).toBe(b);
  });

  it("set différent -> clé différente (jamais un faux doublon)", () => {
    const a = buildProductKey("pokemon_tcg", base);
    const b = buildProductKey("pokemon_tcg", { ...base, setName: "Jungle" });
    expect(a).not.toBe(b);
  });

  it("variante différente -> clé différente", () => {
    const a = buildProductKey("pokemon_tcg", { ...base, variant: "holo" });
    const b = buildProductKey("pokemon_tcg", { ...base, variant: "reverse_holo" });
    expect(a).not.toBe(b);
  });
});
