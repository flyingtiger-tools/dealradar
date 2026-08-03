import { describe, expect, it } from "vitest";
import type { CatalogMatch } from "@dealradar/connectors";
import { corroborateCatalogIdentity } from "../corroborate-catalog-identity";

const CATEGORY_SLUG = "pokemon_tcg";

/** `collectorNumber: null` représente explicitement "absent" — distinct de "non précisé" (clé omise, défaut appliqué). */
interface MatchOverrides {
  name?: string;
  setName?: string;
  collectorNumber?: string | null;
}

function pokemonMatch(overrides: MatchOverrides = {}): CatalogMatch {
  const name = overrides.name ?? "Nymble";
  const setName = overrides.setName ?? "Phantasmal Flames";
  const collectorNumber = overrides.collectorNumber === undefined ? "96" : overrides.collectorNumber;
  return {
    item: {
      source: "pokemon-tcg-api",
      externalId: "me2-96",
      kind: "raw_card",
      categorySlug: CATEGORY_SLUG,
      name,
      canonicalAttributes: collectorNumber === null ? { setId: "me2", setName } : { setId: "me2", setName, collectorNumber },
      images: [],
      externalUrl: null,
    },
    confidence: 1,
    matchedOn: ["name", "setName", "collectorNumber"],
  };
}

function tcgdexMatch(overrides: MatchOverrides = {}): CatalogMatch {
  const name = overrides.name ?? "Nymble";
  const setName = overrides.setName ?? "Phantasmal Flames";
  const collectorNumber = overrides.collectorNumber === undefined ? "096" : overrides.collectorNumber;
  return {
    item: {
      source: "tcgdex",
      externalId: "me02-096",
      kind: "raw_card",
      categorySlug: CATEGORY_SLUG,
      name,
      canonicalAttributes: collectorNumber === null ? { setId: "me02", setName } : { setId: "me02", setName, collectorNumber },
      images: [],
      externalUrl: null,
    },
    confidence: 1,
    matchedOn: ["name", "setName", "collectorNumber"],
  };
}

describe("corroborateCatalogIdentity — comparaison du numéro de collection", () => {
  it('"96" et "096" : identiques (padding différent, même carte)', () => {
    const result = corroborateCatalogIdentity(pokemonMatch({ collectorNumber: "96" }), tcgdexMatch({ collectorNumber: "096" }));
    expect(result?.outcome).toBe("corroborated");
  });

  it('"009" et "9" : identiques', () => {
    const result = corroborateCatalogIdentity(pokemonMatch({ collectorNumber: "9" }), tcgdexMatch({ collectorNumber: "009" }));
    expect(result?.outcome).toBe("corroborated");
  });

  it('"96" et "97" : différents, refus (catalog_diverged)', () => {
    const result = corroborateCatalogIdentity(pokemonMatch({ collectorNumber: "96" }), tcgdexMatch({ collectorNumber: "97" }));
    expect(result?.outcome).toBe("diverged");
    expect(result?.warnings[0]).toContain("numéro");
  });

  it('"TG01" et "TG02" : différents, jamais confondus (formats alphanumériques préservés)', () => {
    const result = corroborateCatalogIdentity(pokemonMatch({ collectorNumber: "TG01" }), tcgdexMatch({ collectorNumber: "TG02" }));
    expect(result?.outcome).toBe("diverged");
    expect(result?.warnings[0]).toContain("numéro");
  });

  it("numéro absent d'un seul côté : jamais un faux match, divergence sur numéro", () => {
    const result = corroborateCatalogIdentity(pokemonMatch({ collectorNumber: null }), tcgdexMatch({ collectorNumber: "096" }));
    expect(result?.outcome).toBe("diverged");
    expect(result?.warnings[0]).toContain("numéro");
  });

  it("numéro absent des deux côtés : jamais une corroboration positive par défaut", () => {
    const result = corroborateCatalogIdentity(pokemonMatch({ collectorNumber: null }), tcgdexMatch({ collectorNumber: null }));
    expect(result?.outcome).toBe("diverged");
    expect(result?.warnings[0]).toContain("numéro");
  });

  it("cas réel Nymble / Phantasmal Flames : nom et set identiques, \"96\" vs \"096\" → corroboration réussie, jamais catalog_diverged", () => {
    const result = corroborateCatalogIdentity(
      pokemonMatch({ name: "Nymble", setName: "Phantasmal Flames", collectorNumber: "96" }),
      tcgdexMatch({ name: "Nymble", setName: "Phantasmal Flames", collectorNumber: "096" }),
    );
    expect(result?.outcome).toBe("corroborated");
    expect(result?.warnings[0]).toContain("corroborée");
  });

  it("non-régression : une vraie divergence de set reste refusée (comportement inchangé)", () => {
    const result = corroborateCatalogIdentity(
      pokemonMatch({ setName: "Base Set", collectorNumber: "58" }),
      tcgdexMatch({ setName: "Jungle", collectorNumber: "58" }),
    );
    expect(result?.outcome).toBe("diverged");
    expect(result?.warnings[0]).toContain("set");
    expect(result?.warnings[0]).not.toContain("numéro");
  });

  it("non-régression : une vraie divergence de nom reste refusée (comportement inchangé)", () => {
    const result = corroborateCatalogIdentity(
      pokemonMatch({ name: "Pikachu", collectorNumber: "58" }),
      tcgdexMatch({ name: "Raichu", collectorNumber: "58" }),
    );
    expect(result?.outcome).toBe("diverged");
    expect(result?.warnings[0]).toContain("nom");
  });
});
