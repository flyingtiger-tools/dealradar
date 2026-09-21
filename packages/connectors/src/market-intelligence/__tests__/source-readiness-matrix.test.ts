import { describe, expect, it } from "vitest";
import { SOURCE_READINESS_MATRIX, resolveSourceReadiness } from "../source-readiness-matrix";

function descriptorFor(source: string) {
  return SOURCE_READINESS_MATRIX.find((d) => d.source === source)!;
}

describe("SOURCE_READINESS_MATRIX", () => {
  it("couvre les 14 sources attendues par le lot", () => {
    const expected = ["ebay", "google_shopping", "dataforseo_google_shopping", "bricklink", "pricecharting", "keepa", "zyte", "ricardo", "tutti", "anibis", "tcgplayer", "stockx", "watchcharts", "frankfurter"];
    expect(SOURCE_READINESS_MATRIX.map((d) => d.source).sort()).toEqual(expected.sort());
  });

  it("aucune source n'est marquée liveTested — honnêteté explicite, aucun appel réel effectué à ce jour", () => {
    expect(SOURCE_READINESS_MATRIX.every((d) => d.liveTested === false)).toBe(true);
  });

  it("les sources bloquées par une décision de politique produit ne sont jamais productionAllowed", () => {
    for (const source of ["ricardo", "tutti", "anibis", "tcgplayer", "stockx", "watchcharts", "pricecharting"]) {
      expect(descriptorFor(source).productionAllowed).toBe(false);
    }
  });

  it("les sources implémentées et sans blocage de politique restent productionAllowed", () => {
    for (const source of ["ebay", "google_shopping", "dataforseo_google_shopping", "bricklink", "keepa", "zyte", "frankfurter"]) {
      expect(descriptorFor(source).productionAllowed).toBe(true);
    }
  });
});

describe("resolveSourceReadiness", () => {
  it("toutes les credentials requises présentes + aucun verrou de politique -> 'ready'", () => {
    const status = resolveSourceReadiness(descriptorFor("keepa"), { KEEPA_API_KEY: true });
    expect(status).toBe("ready");
  });

  it("credential manquante -> 'missing_credentials'", () => {
    const status = resolveSourceReadiness(descriptorFor("keepa"), { KEEPA_API_KEY: false });
    expect(status).toBe("missing_credentials");
  });

  it("un verrou de politique (restricted/disabled_policy/license_required) prime TOUJOURS, même avec toutes les credentials présentes", () => {
    const ricardoStatus = resolveSourceReadiness(descriptorFor("ricardo"), { ZYTE_API_KEY: true });
    expect(ricardoStatus).toBe("restricted");

    const tuttiStatus = resolveSourceReadiness(descriptorFor("tutti"), {});
    expect(tuttiStatus).toBe("disabled_policy");

    const watchChartsStatus = resolveSourceReadiness(descriptorFor("watchcharts"), { WATCHCHARTS_API_KEY: true });
    expect(watchChartsStatus).toBe("license_required");

    const priceChartingStatus = resolveSourceReadiness(descriptorFor("pricecharting"), { PRICECHARTING_TOKEN: true });
    expect(priceChartingStatus).toBe("license_required");
  });

  it("aucune credential requise (Frankfurter) -> toujours 'ready' quel que soit envPresence", () => {
    expect(resolveSourceReadiness(descriptorFor("frankfurter"), {})).toBe("ready");
  });

  it("plusieurs credentials requises : TOUTES doivent être présentes, une seule ne suffit jamais", () => {
    const status = resolveSourceReadiness(descriptorFor("bricklink"), { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true });
    expect(status).toBe("missing_credentials");
  });
});
