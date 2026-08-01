import { describe, expect, it } from "vitest";
import { normalizeJustTcgCard } from "../normalize";
import { PIKACHU_RAW_CARD, CHARIZARD_GRADED_CARD, CARD_WITHOUT_PRICE } from "./fixtures/cards";

describe("normalizeJustTcgCard — carte brute avec correspondance exacte", () => {
  it("produit une observation par variante raw, avec confiance maximale sur indices complets", () => {
    const observations = normalizeJustTcgCard(PIKACHU_RAW_CARD, {
      name: "Pikachu",
      setCode: "base4",
      collectorNumber: "58",
    });
    expect(observations).toHaveLength(2); // NM + LP
    const nm = observations.find((o) => o.condition === "Near Mint")!;
    expect(nm.confidence).toBe(1);
    expect(nm.amountCents).toBe(350);
    expect(nm.gradingCompany).toBeNull();
    expect(nm.grade).toBeNull();
  });

  it("conserve la devise USD d'origine, ne convertit jamais silencieusement", () => {
    const observations = normalizeJustTcgCard(PIKACHU_RAW_CARD, { name: "Pikachu" });
    expect(observations.every((o) => o.currency === "USD")).toBe(true);
    expect(observations.every((o) => o.conversion === undefined)).toBe(true);
  });

  it("attache systématiquement l'avertissement Amérique du Nord — jamais présenté comme suisse/européen", () => {
    const observations = normalizeJustTcgCard(PIKACHU_RAW_CARD, { name: "Pikachu" });
    expect(observations.every((o) => o.warnings.some((w) => w.includes("nord-américain")))).toBe(true);
    expect(observations.every((o) => o.region === "US")).toBe(true);
  });
});

describe("normalizeJustTcgCard — carte gradée avec société et note exactes", () => {
  it("distingue précisément chaque grade, jamais de mélange gradé/brut", () => {
    const observations = normalizeJustTcgCard(CHARIZARD_GRADED_CARD, {
      name: "Charizard",
      setCode: "base4",
      collectorNumber: "4",
      gradingCompany: "PSA",
      grade: "10",
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]!.gradingCompany).toBe("PSA");
    expect(observations[0]!.grade).toBe("PSA 10");
    expect(observations[0]!.amountCents).toBe(1200000);
  });

  it("ne compare jamais une carte brute à une carte gradée dans le même résultat", () => {
    const graded = normalizeJustTcgCard(CHARIZARD_GRADED_CARD, { gradingCompany: "PSA", grade: "10" });
    expect(graded.every((o) => o.gradingCompany !== null)).toBe(true);

    const raw = normalizeJustTcgCard(CHARIZARD_GRADED_CARD, { name: "Charizard" });
    expect(raw.every((o) => o.gradingCompany === null)).toBe(true);
  });
});

describe("normalizeJustTcgCard — mauvais set / mauvais numéro", () => {
  it("confiance réduite quand le set fourni ne correspond pas", () => {
    const observations = normalizeJustTcgCard(PIKACHU_RAW_CARD, { name: "Pikachu", setName: "Jungle" });
    expect(observations[0]!.confidence).toBeLessThan(1);
  });

  it("confiance réduite quand le numéro fourni ne correspond pas", () => {
    const observations = normalizeJustTcgCard(PIKACHU_RAW_CARD, { name: "Pikachu", collectorNumber: "999" });
    expect(observations[0]!.confidence).toBeLessThan(1);
  });
});

describe("normalizeJustTcgCard — variante différente", () => {
  it("n'inclut jamais une variante (printing) différente de celle demandée", () => {
    const observations = normalizeJustTcgCard(CHARIZARD_GRADED_CARD, {
      name: "Charizard",
      extra: { variant: "Reverse Holofoil" }, // n'existe pas dans les fixtures
    });
    expect(observations).toEqual([]);
  });

  it("retourne chaque variante existante correctement étiquetée par elle-même, sans substitution", () => {
    const observations = normalizeJustTcgCard(PIKACHU_RAW_CARD, { name: "Pikachu" });
    const conditions = observations.map((o) => o.condition).sort();
    expect(conditions).toEqual(["Lightly Played", "Near Mint"]);
  });
});

describe("normalizeJustTcgCard — absence de prix", () => {
  it("ne fabrique aucune observation quand price est null", () => {
    const observations = normalizeJustTcgCard(CARD_WITHOUT_PRICE, { name: "Rare Regional Promo" });
    expect(observations).toEqual([]);
  });
});
