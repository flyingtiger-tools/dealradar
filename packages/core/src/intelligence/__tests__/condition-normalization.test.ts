import { describe, expect, it } from "vitest";
import { normalizeCondition, isConditionMismatch } from "../condition-normalization";

describe("normalizeCondition — LEGO scellé vs occasion", () => {
  it("LEGO scellé (completeness sealed) -> new_sealed, même si le texte de condition est vague", () => {
    expect(normalizeCondition({ rawCondition: "new", completeness: "sealed" })).toBe("new_sealed");
    expect(normalizeCondition({ rawCondition: null, completeness: "sealed" })).toBe("new_sealed");
  });

  it("LEGO occasion (BrickLink 'used') -> good, jamais new_sealed ni poor_for_parts", () => {
    expect(normalizeCondition({ rawCondition: "used" })).toBe("good");
  });

  it("scellé et occasion produisent des buckets DIFFÉRENTS — jamais fusionnés", () => {
    const sealed = normalizeCondition({ rawCondition: "new", completeness: "sealed" });
    const used = normalizeCondition({ rawCondition: "used" });
    expect(sealed).not.toBe(used);
    expect(isConditionMismatch(sealed, used)).toBe(true);
  });
});

describe("normalizeCondition — jeu loose vs complete-in-box", () => {
  it("PriceCharting 'new' avec completeness sealed -> new_sealed", () => {
    expect(normalizeCondition({ rawCondition: "new", completeness: "sealed" })).toBe("new_sealed");
  });

  it("loose (aucun texte de condition, completeness loose) -> unknown, jamais deviné positivement", () => {
    expect(normalizeCondition({ rawCondition: null, completeness: "loose" })).toBe("unknown");
  });
});

describe("normalizeCondition — téléphone bon état vs mauvais état", () => {
  it("'good' -> good", () => {
    expect(normalizeCondition({ rawCondition: "good" })).toBe("good");
  });

  it("'for parts not working' -> poor_for_parts", () => {
    expect(normalizeCondition({ rawCondition: "for parts not working" })).toBe("poor_for_parts");
  });

  it("bon état et mauvais état sont des buckets DIFFÉRENTS, incompatibles", () => {
    const good = normalizeCondition({ rawCondition: "good" });
    const poor = normalizeCondition({ rawCondition: "for parts not working" });
    expect(isConditionMismatch(good, poor)).toBe(true);
  });
});

describe("normalizeCondition — sneaker neuve vs portée", () => {
  it("'deadstock'/'unworn' -> new_sealed", () => {
    expect(normalizeCondition({ rawCondition: "deadstock" })).toBe("new_sealed");
    expect(normalizeCondition({ rawCondition: "unworn" })).toBe("new_sealed");
  });

  it("'very good' (portée mais bon état) -> very_good, distinct de new_sealed", () => {
    const worn = normalizeCondition({ rawCondition: "very good" });
    expect(worn).toBe("very_good");
    expect(isConditionMismatch("new_sealed", worn)).toBe(true);
  });
});

describe("normalizeCondition — cas généraux", () => {
  it("texte absent/vide -> unknown, jamais un bucket positif fabriqué", () => {
    expect(normalizeCondition({ rawCondition: null })).toBe("unknown");
    expect(normalizeCondition({ rawCondition: "" })).toBe("unknown");
    expect(normalizeCondition({ rawCondition: undefined })).toBe("unknown");
  });

  it("'brand new'/'new_other' (Google Shopping/eBay) -> new_sealed, même bucket qu'un simple 'new'", () => {
    expect(normalizeCondition({ rawCondition: "brand new" })).toBe("new_sealed");
    expect(normalizeCondition({ rawCondition: "new_other" })).toBe("new_sealed");
    expect(normalizeCondition({ rawCondition: "new" })).toBe("new_sealed");
  });

  it("'refurbished' (Keepa) -> good, un défaut documenté raisonnable, jamais new_sealed", () => {
    expect(normalizeCondition({ rawCondition: "refurbished" })).toBe("good");
  });

  it("'for parts' prime sur un texte contenant aussi 'used' — jamais classé good par erreur", () => {
    expect(normalizeCondition({ rawCondition: "used for parts or not working" })).toBe("poor_for_parts");
  });
});

describe("isConditionMismatch", () => {
  it("jamais un blocage quand l'un des deux côtés est unknown", () => {
    expect(isConditionMismatch("unknown", "good")).toBe(false);
    expect(isConditionMismatch("good", "unknown")).toBe(false);
    expect(isConditionMismatch(null, "good")).toBe(false);
  });

  it("bloque uniquement quand les deux buckets sont CONNUS et diffèrent", () => {
    expect(isConditionMismatch("good", "good")).toBe(false);
    expect(isConditionMismatch("good", "fair")).toBe(true);
  });
});
