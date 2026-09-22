import { describe, expect, it } from "vitest";
import { SOURCE_READINESS_MATRIX, resolveSourceReadiness } from "../source-readiness-matrix";

function descriptorFor(source: string) {
  return SOURCE_READINESS_MATRIX.find((d) => d.source === source)!;
}

const PRE_EXISTING_SOURCES = ["ebay", "google_shopping", "dataforseo_google_shopping", "bricklink", "pricecharting", "keepa", "zyte", "ricardo", "tutti", "anibis", "tcgplayer", "stockx", "watchcharts", "frankfurter"];

/** Ajoutées LOT "Free/Open Sources + Real Readiness + Live Smoke Tests" (section 10). */
const NEW_IDENTITY_AND_PRICE_SOURCES = ["tcgdex", "pokemon_tcg_api", "open_food_facts", "open_products_facts", "rebrickable", "wikidata", "open_prices", "igdb"];

describe("SOURCE_READINESS_MATRIX", () => {
  it("couvre les 14 sources pré-existantes ET les 8 sources ajoutées ce lot, aucun doublon", () => {
    const expected = [...PRE_EXISTING_SOURCES, ...NEW_IDENTITY_AND_PRICE_SOURCES];
    expect(SOURCE_READINESS_MATRIX.map((d) => d.source).sort()).toEqual(expected.sort());
    expect(new Set(SOURCE_READINESS_MATRIX.map((d) => d.source)).size).toBe(SOURCE_READINESS_MATRIX.length);
  });

  it("les sources pré-existantes restent liveTested=false — honnêteté explicite, aucun appel réel effectué pour elles à ce jour", () => {
    for (const source of PRE_EXISTING_SOURCES) {
      expect(descriptorFor(source).liveTested).toBe(false);
    }
  });

  it("les sources bloquées par une décision de politique produit ne sont jamais productionAllowed", () => {
    for (const source of ["ricardo", "tutti", "anibis", "tcgplayer", "stockx", "watchcharts", "pricecharting", "pokemon_tcg_api", "igdb"]) {
      expect(descriptorFor(source).productionAllowed).toBe(false);
    }
  });

  it("les sources implémentées et sans blocage de politique restent productionAllowed", () => {
    for (const source of ["ebay", "google_shopping", "dataforseo_google_shopping", "bricklink", "keepa", "zyte", "frankfurter", "tcgdex", "open_food_facts", "open_products_facts", "rebrickable", "wikidata", "open_prices"]) {
      expect(descriptorFor(source).productionAllowed).toBe(true);
    }
  });

  describe("sources ajoutées ce lot (LOT 'Free/Open Sources + Real Readiness + Live Smoke Tests')", () => {
    it("live-testées ce lot par appel réel : tcgdex, open_food_facts, open_products_facts, wikidata, open_prices", () => {
      for (const source of ["tcgdex", "open_food_facts", "open_products_facts", "wikidata", "open_prices"]) {
        expect(descriptorFor(source).liveTested).toBe(true);
      }
    });

    it("JAMAIS live-testées (pas de credential disponible en session, ou verrouillées) : rebrickable, igdb, pokemon_tcg_api", () => {
      for (const source of ["rebrickable", "igdb", "pokemon_tcg_api"]) {
        expect(descriptorFor(source).liveTested).toBe(false);
      }
    });

    it("igdb : verrouillé commercialement, jamais 'gratuit pour la production' même si les deux credentials sont posées", () => {
      const status = resolveSourceReadiness(descriptorFor("igdb"), { IGDB_CLIENT_ID: true, IGDB_CLIENT_SECRET: true });
      expect(status).toBe("license_required");
      expect(descriptorFor("igdb").freeClass).toBe("commercial_approval_required");
    });

    it("pokemon_tcg_api : verrouillé par politique (projet en fin de vie annoncée), jamais réactivé par une simple credential", () => {
      const status = resolveSourceReadiness(descriptorFor("pokemon_tcg_api"), { POKEMONTCG_API_KEY: true });
      expect(status).toBe("disabled_policy");
    });

    it("capability catalogIdentity/barcodeLookup jamais mélangée avec une capability de prix pour les sources d'identité pure", () => {
      for (const source of ["tcgdex", "pokemon_tcg_api", "open_food_facts", "open_products_facts", "rebrickable", "wikidata", "igdb"]) {
        expect(descriptorFor(source).capabilities).not.toContain("retailPrices");
        expect(descriptorFor(source).capabilities).not.toContain("soldTransactions");
      }
    });

    it("open_prices est la SEULE des 8 nouvelles sources à porter une capability de prix (retailPrices)", () => {
      expect(descriptorFor("open_prices").capabilities).toEqual(["retailPrices"]);
    });

    it("chaque nouvelle source déclare une freeClass explicite — jamais laissée indéfinie", () => {
      for (const source of NEW_IDENTITY_AND_PRICE_SOURCES) {
        expect(descriptorFor(source).freeClass).toBeDefined();
      }
    });
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
