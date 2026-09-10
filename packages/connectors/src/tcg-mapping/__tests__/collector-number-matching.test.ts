import { describe, expect, it } from "vitest";
import { collectorNumbersMatch, normalizeCollectorNumber } from "../collector-number-matching";

/**
 * Tests de non-régression dédiés (Phase 6, revue "long lot local") —
 * jusqu'ici cette fonction n'était couverte qu'indirectement via
 * `cross-match.test.ts`/`derive-catalog-query-collector-number.test.ts`.
 * Couvre explicitement le cas historique Nymble 96/096 (padding de zéro
 * entre Pokémon TCG API et TCGdex, LOT 7C) et les formats alphanumériques
 * (SWSH123, TG12, SVP001) pour garantir qu'aucun zéro de tête n'est retiré
 * après une lettre.
 */
describe("normalizeCollectorNumber", () => {
  it("retire les zéros de tête d'un numéro purement numérique", () => {
    expect(normalizeCollectorNumber("096")).toBe("96");
    expect(normalizeCollectorNumber("001")).toBe("1");
    expect(normalizeCollectorNumber("1")).toBe("1");
    expect(normalizeCollectorNumber("96")).toBe("96");
  });

  it("retire le dénominateur \"/total\" avant de normaliser", () => {
    expect(normalizeCollectorNumber("96/96")).toBe("96");
    expect(normalizeCollectorNumber("096/096")).toBe("96");
    expect(normalizeCollectorNumber("096/96")).toBe("96");
    expect(normalizeCollectorNumber("96/096")).toBe("96");
    expect(normalizeCollectorNumber("001/198")).toBe("1");
    expect(normalizeCollectorNumber("1/198")).toBe("1");
  });

  it("ne retire JAMAIS un zéro de tête après une lettre (numéros alphanumériques)", () => {
    expect(normalizeCollectorNumber("SWSH123")).toBe("swsh123");
    expect(normalizeCollectorNumber("TG12")).toBe("tg12");
    expect(normalizeCollectorNumber("SVP001")).toBe("svp001");
  });

  it("est insensible à la casse", () => {
    expect(normalizeCollectorNumber("swsh123")).toBe(normalizeCollectorNumber("SWSH123"));
  });

  it("ne modifie jamais un zéro de tête au milieu d'un numéro alphanumérique différemment de son homologue exact", () => {
    // "TG012" et "TG12" sont deux numéros DIFFÉRENTS dans le monde réel (le zéro
    // de tête n'est retiré que pour un numéro purement numérique) — vérifie
    // qu'aucun faux positif n'est introduit pour les séries alphanumériques.
    expect(normalizeCollectorNumber("TG012")).not.toBe(normalizeCollectorNumber("TG12"));
  });
});

describe("collectorNumbersMatch", () => {
  it("cas historique Nymble : \"96\" et \"096\" correspondent (padding de zéro)", () => {
    expect(collectorNumbersMatch("96", "096")).toBe(true);
    expect(collectorNumbersMatch("096", "96")).toBe(true);
  });

  it("toutes les variantes \"total\" + padding de la même carte correspondent entre elles", () => {
    const variants = ["96", "096", "96/96", "096/096", "096/96", "96/096"];
    for (const a of variants) {
      for (const b of variants) {
        expect(collectorNumbersMatch(a, b)).toBe(true);
      }
    }
  });

  it("numéros alphanumériques identiques correspondent (insensible à la casse)", () => {
    expect(collectorNumbersMatch("SWSH123", "swsh123")).toBe(true);
    expect(collectorNumbersMatch("TG12", "tg12")).toBe(true);
    expect(collectorNumbersMatch("SVP001", "SVP001")).toBe(true);
  });

  it("numéros avec dénominateur \"/total\" et padding correspondent à leur forme courte", () => {
    expect(collectorNumbersMatch("001/198", "1/198")).toBe(true);
    expect(collectorNumbersMatch("001/198", "1")).toBe(true);
    expect(collectorNumbersMatch("1/198", "001")).toBe(true);
  });

  it("numéros réellement différents ne correspondent jamais (aucun faux positif)", () => {
    expect(collectorNumbersMatch("96", "97")).toBe(false);
    expect(collectorNumbersMatch("096", "97")).toBe(false);
    expect(collectorNumbersMatch("SWSH123", "SWSH124")).toBe(false);
    expect(collectorNumbersMatch("TG12", "TG13")).toBe(false);
    expect(collectorNumbersMatch("TG12", "SVP012")).toBe(false);
    expect(collectorNumbersMatch("001/198", "2/198")).toBe(false);
  });

  it("un numéro alphanumérique et un numéro purement numérique ne correspondent jamais même si les chiffres se ressemblent", () => {
    expect(collectorNumbersMatch("TG12", "12")).toBe(false);
    expect(collectorNumbersMatch("SVP001", "1")).toBe(false);
  });

  it("null/undefined/chaîne vide ne correspondent jamais, même entre eux", () => {
    expect(collectorNumbersMatch(null, "96")).toBe(false);
    expect(collectorNumbersMatch("96", undefined)).toBe(false);
    expect(collectorNumbersMatch(null, null)).toBe(false);
    expect(collectorNumbersMatch("", "96")).toBe(false);
  });
});
