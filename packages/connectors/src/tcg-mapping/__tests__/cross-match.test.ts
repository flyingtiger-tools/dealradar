import { describe, expect, it } from "vitest";
import { matchCard } from "../../catalogs/pokemon-tcg/normalize";
import { normalizeJustTcgCard } from "../../pricing/justtcg/normalize";
import type { TcgCatalogHints } from "../../catalogs/tcg/types";
import type { NormalizedPriceObservation } from "../../types";
import { buildCanonicalIdentity, classifyCrossMatch, mapToJustTcgQuery } from "../pokemon-to-justtcg";
import {
  JUSTTCG_CHARIZARD_GRADED,
  JUSTTCG_PIKACHU_MULTI_VARIANT,
  JUSTTCG_PIKACHU_NO_PRICE,
  JUSTTCG_PIKACHU_PADDED_NUMBER,
  JUSTTCG_PIKACHU_WRONG_NUMBER,
  JUSTTCG_PIKACHU_WRONG_SET,
  POKEMON_CHARIZARD,
  POKEMON_PIKACHU,
} from "./fixtures/aligned-cards";

/**
 * LOT 3 — mapping Pokémon TCG API ↔ JustTCG. Toutes les identités et
 * observations viennent des vraies fonctions LOT 1 (`matchCard`) et LOT 2
 * (`normalizeJustTcgCard`) appliquées aux fixtures alignées — jamais
 * d'objets `NormalizedPriceObservation`/`CatalogMatch` reconstruits à la main.
 */

const PIKACHU_FULL_HINTS: TcgCatalogHints = {
  name: "Pikachu",
  setName: "Base Set",
  setCode: "base4",
  collectorNumber: "58",
};

const CHARIZARD_FULL_HINTS: TcgCatalogHints = {
  name: "Charizard",
  setName: "Base Set",
  setCode: "base4",
  collectorNumber: "4",
};

describe("LOT 3 — cross-match Pokémon TCG API ↔ JustTCG", () => {
  it("carte brute exacte : match sur set + numéro + variante Normal", () => {
    const catalogHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, extra: { variant: "Normal" }, language: "English" };
    const catalogMatch = matchCard(POKEMON_PIKACHU, catalogHints);
    const identity = buildCanonicalIdentity(catalogMatch, catalogHints);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(1);
    expect(result.priceObservations[0]!.variant).toBe("Normal");
    expect(result.priceObservations[0]!.amountCents).toBe(150);
    expect(result.confidence).toBe(1);
  });

  it("numéro au format réel JustTCG (\"058/102\", zéro de tête + dénominateur) : corrobore avec le numéro simple du catalogue", () => {
    const catalogHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, extra: { variant: "Normal" }, language: "English" };
    const catalogMatch = matchCard(POKEMON_PIKACHU, catalogHints);
    const identity = buildCanonicalIdentity(catalogMatch, catalogHints);
    expect(identity.cardNumber).toBe("58");
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_PADDED_NUMBER, justTcgHints);
    expect(observations[0]!.number).toBe("058/102");

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(1);
    expect(result.priceObservations[0]!.amountCents).toBe(768);
  });

  it("holo exacte : match sur la variante Holofoil, jamais confondue avec Normal", () => {
    const catalogHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, extra: { variant: "Holofoil" }, language: "English" };
    const catalogMatch = matchCard(POKEMON_PIKACHU, catalogHints);
    const identity = buildCanonicalIdentity(catalogMatch, catalogHints);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(1);
    expect(result.priceObservations[0]!.variant).toBe("Holofoil");
    expect(result.priceObservations[0]!.amountCents).toBe(500);
  });

  it("reverse holo : match sur Reverse Holofoil, jamais confondue avec Holofoil ou Normal", () => {
    const catalogHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, extra: { variant: "Reverse Holofoil" }, language: "English" };
    const catalogMatch = matchCard(POKEMON_PIKACHU, catalogHints);
    const identity = buildCanonicalIdentity(catalogMatch, catalogHints);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(1);
    expect(result.priceObservations[0]!.variant).toBe("Reverse Holofoil");
    expect(result.priceObservations[0]!.amountCents).toBe(800);
  });

  it("carte gradée PSA 10 exacte : jamais comparée à une carte brute", () => {
    const catalogHints: TcgCatalogHints = CHARIZARD_FULL_HINTS;
    const catalogMatch = matchCard(POKEMON_CHARIZARD, catalogHints);
    const gradedHints: TcgCatalogHints = { ...catalogHints, gradingCompany: "PSA", grade: "10" };
    const identity = buildCanonicalIdentity(catalogMatch, gradedHints);
    expect(identity.isGraded).toBe(true);
    expect(identity.productKind).toBe("graded_card");

    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_CHARIZARD_GRADED, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(1);
    expect(result.priceObservations[0]!.gradingCompany).toBe("PSA");
    expect(result.priceObservations[0]!.grade).toBe("PSA 10");
    expect(result.priceObservations[0]!.amountCents).toBe(1_200_000);
    // Le raw_holo (450$) présent dans la même fiche ne doit jamais être choisi à la place.
    expect(result.priceObservations[0]!.amountCents).not.toBe(45_000);
  });

  it("mauvaise note : PSA 5 n'existe pas pour cette carte — refus, jamais un PSA voisin", () => {
    const catalogMatch = matchCard(POKEMON_CHARIZARD, CHARIZARD_FULL_HINTS);
    const gradedHints: TcgCatalogHints = { ...CHARIZARD_FULL_HINTS, gradingCompany: "PSA", grade: "5" };
    const identity = buildCanonicalIdentity(catalogMatch, gradedHints);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_CHARIZARD_GRADED, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it("mauvaise société de grading : CGC demandé, seuls PSA/BGS existent — refus", () => {
    const catalogMatch = matchCard(POKEMON_CHARIZARD, CHARIZARD_FULL_HINTS);
    const gradedHints: TcgCatalogHints = { ...CHARIZARD_FULL_HINTS, gradingCompany: "CGC", grade: "10" };
    const identity = buildCanonicalIdentity(catalogMatch, gradedHints);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_CHARIZARD_GRADED, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
  });

  it("mauvais set : le catalogue attend Base Set, JustTCG renvoie Jungle — refus", () => {
    const catalogMatch = matchCard(POKEMON_PIKACHU, PIKACHU_FULL_HINTS);
    const identity = buildCanonicalIdentity(catalogMatch, PIKACHU_FULL_HINTS);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_WRONG_SET, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("set"))).toBe(true);
  });

  it("mauvais numéro : même set, numéro différent — refus", () => {
    const catalogMatch = matchCard(POKEMON_PIKACHU, PIKACHU_FULL_HINTS);
    const identity = buildCanonicalIdentity(catalogMatch, PIKACHU_FULL_HINTS);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_WRONG_NUMBER, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("number") || w.toLowerCase().includes("numéro") || w.includes("number"))).toBe(true);
  });

  it("mauvaise variante : aucune variante JustTCG ne corrobore la variante demandée — refus", () => {
    const catalogHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, extra: { variant: "1st Edition Holofoil" } };
    const catalogMatch = matchCard(POKEMON_PIKACHU, catalogHints);
    const identity = buildCanonicalIdentity(catalogMatch, catalogHints);

    // Volontairement sans extra.variant côté requête JustTCG, pour que
    // `buildCandidateVariants` renvoie toutes les variantes existantes et que
    // ce soit `classifyCrossMatch`/`corroborates` (deuxième ligne de défense,
    // indépendante du filtrage JustTCG) qui les rejette une à une.
    const justTcgHints: TcgCatalogHints = { name: "Pikachu", setName: "Base Set", setCode: "base4", collectorNumber: "58" };
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);
    expect(observations.length).toBeGreaterThan(1);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("variant"))).toBe(true);
  });

  it("nom seul : aucun set ni numéro confirmé par le catalogue — refus automatique, même si JustTCG a des prix", () => {
    const catalogMatch = matchCard(POKEMON_PIKACHU, { name: "Pikachu" });
    expect(catalogMatch.matchedOn).toEqual(["name"]);
    const identity = buildCanonicalIdentity(catalogMatch, { name: "Pikachu" });
    expect(identity.setName).toBeNull();
    expect(identity.cardNumber).toBeNull();

    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("nom seul"))).toBe(true);
  });

  it("langue différente : désaccord explicite FR/EN — jamais une équivalence silencieuse, refus", () => {
    const catalogHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, extra: { variant: "Normal" }, language: "French" };
    const catalogMatch = matchCard(POKEMON_PIKACHU, catalogHints);
    const identity = buildCanonicalIdentity(catalogMatch, catalogHints);
    expect(identity.language).toBe("French");

    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);
    expect(observations[0]!.language).toBe("English");

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("language"))).toBe(true);
  });

  it("langue absente d'une source : avertissement explicite, jamais un refus ni un exact_match silencieux", () => {
    // v_no_lang porte printing "Unlimited" et aucune langue — la carte catalogue
    // demande explicitement "English", que JustTCG ne peut pas confirmer.
    const catalogHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, extra: { variant: "Unlimited" }, language: "English" };
    const catalogMatch = matchCard(POKEMON_PIKACHU, catalogHints);
    const identity = buildCanonicalIdentity(catalogMatch, catalogHints);

    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);
    expect(observations).toHaveLength(1);
    expect(observations[0]!.language).toBeNull();

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("probable_match");
    expect(result.priceObservations).toHaveLength(1);
    expect(result.warnings.some((w) => w.toLowerCase().includes("langue"))).toBe(true);
  });

  it("absence de prix : la seule variante correspondante n'a pas de prix local — refus, aucun prix inventé", () => {
    const catalogHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, extra: { variant: "Normal" } };
    const catalogMatch = matchCard(POKEMON_PIKACHU, catalogHints);
    const identity = buildCanonicalIdentity(catalogMatch, catalogHints);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_NO_PRICE, justTcgHints);
    expect(observations).toHaveLength(0);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("prix"))).toBe(true);
  });

  it("plusieurs variantes/langues sans indice précisé : observations distinctes conservées séparément, jamais fusionnées en une ambiguïté artificielle (LOT 7C)", () => {
    // Avant LOT 7C, ce cas retournait "ambiguous" dès que plus d'un candidat
    // corroborait — confondant la multiplicité d'observations légitimes
    // (variante/langue non précisées par l'identité) avec une vraie
    // ambiguïté d'identité. Chaque variante/langue distincte reste ici sa
    // propre observation traçable ; l'absence de langue confirmée sur la
    // plupart d'entre elles dégrade en `probable_match` (jamais un refus,
    // jamais un `exact_match` silencieux).
    const catalogMatch = matchCard(POKEMON_PIKACHU, PIKACHU_FULL_HINTS);
    const identity = buildCanonicalIdentity(catalogMatch, PIKACHU_FULL_HINTS);
    expect(identity.language).toBeNull();
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    expect((justTcgHints.extra as Record<string, string> | undefined)?.variant).toBeUndefined();
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);
    expect(observations.length).toBeGreaterThan(1);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("probable_match");
    expect(result.priceObservations).toHaveLength(5);
    expect(new Set(result.priceObservations.map((o) => `${o.variant ?? ""}|${o.language ?? ""}`)).size).toBe(5);
    expect(result.warnings.some((w) => w.toLowerCase().includes("langue"))).toBe(true);
    expect(result.warnings.some((w) => w.toLowerCase().includes("ambig"))).toBe(false);
  });

  it("produit scellé refusé : un booster pack n'est jamais résolu par cette correspondance", () => {
    const catalogMatch = matchCard(POKEMON_PIKACHU, PIKACHU_FULL_HINTS);
    const sealedHints: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, kind: "booster_pack" };
    const identity = buildCanonicalIdentity(catalogMatch, sealedHints);
    expect(identity.productKind).toBe("booster_pack");

    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("scellé"))).toBe(true);
  });
});

/**
 * LOT 7C — correctif : `classifyCrossMatch` doit distinguer strictement
 * l'ambiguïté d'identité (plusieurs candidats DIFFÉRENTS pour exactement la
 * même combinaison devise/condition/variante/langue/grade/société/source)
 * de la multiplicité légitime d'observations de prix pour UNE SEULE
 * identité confirmée (devises différentes, conditions différentes, sources
 * différentes...). Observations construites directement ici (plutôt que via
 * `normalizeJustTcgCard`) car ces scénarios combinent délibérément des
 * sources/devises/conditions qu'aucune fixture API unique ne peut produire
 * en une seule fois — c'est le comportement de `classifyCrossMatch`
 * lui-même, fonction pure sur `(identity, observations[])`, qui est testé.
 */
describe("LOT 7C — classifyCrossMatch : ambiguïté d'identité vs multiplicité d'observations", () => {
  const PIKACHU_ENGLISH_HINTS: TcgCatalogHints = { ...PIKACHU_FULL_HINTS, language: "English" };

  function baseIdentity() {
    const catalogMatch = matchCard(POKEMON_PIKACHU, PIKACHU_FULL_HINTS);
    return buildCanonicalIdentity(catalogMatch, PIKACHU_ENGLISH_HINTS);
  }

  function makeObservation(overrides: Partial<NormalizedPriceObservation> = {}): NormalizedPriceObservation {
    return {
      source: "justtcg",
      externalProductId: "obs-test",
      game: "Pokémon",
      name: "Pikachu",
      setName: "Base Set",
      setId: "base4",
      number: "58",
      variant: "Normal",
      language: "English",
      condition: null,
      gradingCompany: null,
      grade: null,
      amountCents: 100,
      currency: "USD",
      priceType: "market_aggregate",
      updatedAt: null,
      region: "US",
      provenance: "test-fixture",
      confidence: 1,
      warnings: [],
      ...overrides,
    };
  }

  it("1. EUR + USD pour la même identité confirmée : exact_match avec 2 observations, jamais moyennées", () => {
    const identity = baseIdentity();
    const eur = makeObservation({ source: "tcgdex", currency: "EUR", amountCents: 500, provenance: "tcgdex-cardmarket" });
    const usd = makeObservation({ source: "tcgdex", currency: "USD", amountCents: 650, provenance: "tcgdex-tcgplayer" });

    const result = classifyCrossMatch(identity, [eur, usd]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(2);
    expect(result.priceObservations.map((o) => o.currency).sort()).toEqual(["EUR", "USD"]);
    expect(result.priceObservations.find((o) => o.currency === "EUR")!.amountCents).toBe(500);
    expect(result.priceObservations.find((o) => o.currency === "USD")!.amountCents).toBe(650);
  });

  it("2. NM + LP + MP pour la même carte : exact_match avec 3 observations distinctes par condition", () => {
    const identity = baseIdentity();
    const nm = makeObservation({ condition: "Near Mint", amountCents: 100 });
    const lp = makeObservation({ condition: "Lightly Played", amountCents: 80 });
    const mp = makeObservation({ condition: "Moderately Played", amountCents: 60 });

    const result = classifyCrossMatch(identity, [nm, lp, mp]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(3);
    expect(new Set(result.priceObservations.map((o) => o.condition)).size).toBe(3);
  });

  it("3. TCGdex EUR + TCGdex USD + JustTCG USD : trois observations séparées, jamais moyennées ni fusionnées entre sources", () => {
    const identity = baseIdentity();
    const tcgdexEur = makeObservation({ source: "tcgdex", currency: "EUR", amountCents: 500, provenance: "tcgdex-cardmarket" });
    const tcgdexUsd = makeObservation({ source: "tcgdex", currency: "USD", amountCents: 650, provenance: "tcgdex-tcgplayer" });
    const justTcgUsd = makeObservation({ source: "justtcg", currency: "USD", condition: "Near Mint", amountCents: 700, provenance: "justtcg-api-v2" });

    const result = classifyCrossMatch(identity, [tcgdexEur, tcgdexUsd, justTcgUsd]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(3);
    expect(result.priceObservations.map((o) => `${o.source}:${o.currency}:${o.condition ?? ""}`).sort()).toEqual(
      ["justtcg:USD:Near Mint", "tcgdex:EUR:", "tcgdex:USD:"].sort(),
    );
  });

  it("4. Deux sources différentes sur le même marketSlotKey (USD/Near Mint) : observations séparées, jamais moyennées", () => {
    const identity = baseIdentity();
    const fromJustTcg = makeObservation({ source: "justtcg", currency: "USD", condition: "Near Mint", amountCents: 700, provenance: "justtcg-api-v2" });
    const fromOtherSource = makeObservation({
      source: "another-pricing-source",
      currency: "USD",
      condition: "Near Mint",
      amountCents: 750,
      provenance: "another-pricing-source-v1",
    });

    const result = classifyCrossMatch(identity, [fromJustTcg, fromOtherSource]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(2);
    expect(result.priceObservations.map((o) => o.amountCents).sort((a, b) => a - b)).toEqual([700, 750]);
    // Jamais moyennées : aucune observation ne doit valoir la moyenne (725) des deux sources.
    expect(result.priceObservations.every((o) => o.amountCents !== 725)).toBe(true);
  });

  it("4b. Même marketSlotKey, même source, doublon exact (même montant) : déduplication silencieuse en une seule observation, jamais une ambiguïté", () => {
    const identity = baseIdentity();
    const first = makeObservation({ source: "justtcg", currency: "USD", condition: "Near Mint", externalProductId: "fetch-1", amountCents: 700 });
    const duplicate = makeObservation({ source: "justtcg", currency: "USD", condition: "Near Mint", externalProductId: "fetch-2", amountCents: 700 });

    const result = classifyCrossMatch(identity, [first, duplicate]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(1);
    expect(result.priceObservations[0]!.amountCents).toBe(700);
  });

  it("4c. Deux sources sur le même marketSlotKey avec des prix très divergents : les deux conservées séparément, jamais moyennées, jamais refusées", () => {
    const identity = baseIdentity();
    const cheap = makeObservation({ source: "justtcg", currency: "USD", condition: "Near Mint", externalProductId: "cheap", amountCents: 50 });
    const expensive = makeObservation({ source: "another-pricing-source", currency: "USD", condition: "Near Mint", externalProductId: "expensive", amountCents: 50_000 });

    const result = classifyCrossMatch(identity, [cheap, expensive]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(2);
    expect(result.priceObservations.map((o) => o.amountCents).sort((a, b) => a - b)).toEqual([50, 50_000]);
    expect(result.warnings.some((w) => w.toLowerCase().includes("ambig"))).toBe(false);
  });

  it("4d. Confiance d'identité jamais gonflée par le nombre de sources tarifaires : identity.confidence=0.5 (repli single_catalog_source) avec plusieurs observations fortes reste probable_match, jamais exact_match", () => {
    const identity = { ...baseIdentity(), confidence: 0.5 };
    const observations = [
      makeObservation({ source: "justtcg", currency: "USD", condition: "Near Mint", amountCents: 700 }),
      makeObservation({ source: "tcgdex", currency: "EUR", amountCents: 500, provenance: "tcgdex-cardmarket" }),
      makeObservation({ source: "another-pricing-source", currency: "USD", condition: "Lightly Played", amountCents: 300 }),
    ];

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("probable_match");
    expect(result.priceObservations).toHaveLength(3);
    expect(result.outcome).not.toBe("exact_match");
  });

  it("5. Holo + Reverse Holo sans variante fixée par l'identité : observations distinctes, jamais fusionnées", () => {
    const identity = baseIdentity();
    expect(identity.variant).toBeNull();
    const holo = makeObservation({ variant: "Holofoil", amountCents: 500 });
    const reverse = makeObservation({ variant: "Reverse Holofoil", amountCents: 800 });

    const result = classifyCrossMatch(identity, [holo, reverse]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(2);
    expect(result.priceObservations.map((o) => o.variant).sort()).toEqual(["Holofoil", "Reverse Holofoil"]);
  });

  it("6. Brut + PSA10 : jamais fusionnés — seule l'observation du bon statut (brut) est retenue", () => {
    const identity = baseIdentity();
    expect(identity.isGraded).toBe(false);
    const raw = makeObservation({ amountCents: 100 });
    const psa10 = makeObservation({ gradingCompany: "PSA", grade: "PSA 10", amountCents: 12000 });

    const result = classifyCrossMatch(identity, [raw, psa10]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(1);
    expect(result.priceObservations[0]!.amountCents).toBe(100);
    expect(result.priceObservations[0]!.gradingCompany).toBeNull();
  });

  it("7. PSA9 + PSA10 pour la même carte gradée (grade non fixé par l'identité) : observations distinctes, jamais fusionnées", () => {
    const catalogMatch = matchCard(POKEMON_CHARIZARD, CHARIZARD_FULL_HINTS);
    const gradedHints: TcgCatalogHints = { ...CHARIZARD_FULL_HINTS, gradingCompany: "PSA", language: "English" };
    const identity = buildCanonicalIdentity(catalogMatch, gradedHints);
    expect(identity.isGraded).toBe(true);
    expect(identity.grade).toBeNull();

    const psa9 = makeObservation({ name: "Charizard", number: "4", variant: null, gradingCompany: "PSA", grade: "PSA 9", amountCents: 320_000 });
    const psa10 = makeObservation({ name: "Charizard", number: "4", variant: null, gradingCompany: "PSA", grade: "PSA 10", amountCents: 1_200_000 });

    const result = classifyCrossMatch(identity, [psa9, psa10]);

    expect(result.outcome).toBe("exact_match");
    expect(result.priceObservations).toHaveLength(2);
    expect(result.priceObservations.map((o) => o.grade).sort()).toEqual(["PSA 10", "PSA 9"]);
  });

  it("8. Même observationKey (même source, même segment exact), montants différents : ambiguous, aucune décision automatique — distinct d'un doublon exact (4b)", () => {
    const identity = baseIdentity();
    const candidateA = makeObservation({ externalProductId: "candidate-a", amountCents: 100 });
    const candidateB = makeObservation({ externalProductId: "candidate-b", amountCents: 999 });

    const result = classifyCrossMatch(identity, [candidateA, candidateB]);

    expect(result.outcome).toBe("ambiguous");
    expect(result.priceObservations).toHaveLength(2);
    expect(result.warnings.some((w) => w.toLowerCase().includes("ambig"))).toBe(true);
  });

  it("9. Plusieurs candidats apparemment identiques (même observationKey) mais des montants tous différents : ambiguous même avec plus de deux candidats", () => {
    const identity = baseIdentity();
    const candidates = [
      makeObservation({ externalProductId: "cand-1", amountCents: 100 }),
      makeObservation({ externalProductId: "cand-2", amountCents: 105 }),
      makeObservation({ externalProductId: "cand-3", amountCents: 110 }),
    ];

    const result = classifyCrossMatch(identity, candidates);

    expect(result.outcome).toBe("ambiguous");
    expect(result.priceObservations).toHaveLength(3);
  });

  it("10. Aucun candidat ne corrobore l'identité : no_match, jamais une observation retenue par défaut", () => {
    const identity = baseIdentity();
    const wrongNumber = makeObservation({ number: "99" });

    const result = classifyCrossMatch(identity, [wrongNumber]);

    expect(result.outcome).toBe("no_match");
    expect(result.priceObservations).toHaveLength(0);
  });
});
