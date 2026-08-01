import { describe, expect, it } from "vitest";
import { matchCard } from "../../catalogs/pokemon-tcg/normalize";
import { normalizeJustTcgCard } from "../../pricing/justtcg/normalize";
import type { TcgCatalogHints } from "../../catalogs/tcg/types";
import { buildCanonicalIdentity, classifyCrossMatch, mapToJustTcgQuery } from "../pokemon-to-justtcg";
import {
  JUSTTCG_CHARIZARD_GRADED,
  JUSTTCG_PIKACHU_MULTI_VARIANT,
  JUSTTCG_PIKACHU_NO_PRICE,
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

  it("plusieurs candidats ambigus : aucune variante précisée, plusieurs prix corroborent à égalité — jamais de décision automatique", () => {
    const catalogMatch = matchCard(POKEMON_PIKACHU, PIKACHU_FULL_HINTS);
    const identity = buildCanonicalIdentity(catalogMatch, PIKACHU_FULL_HINTS);
    const justTcgHints = mapToJustTcgQuery(identity).hints as TcgCatalogHints;
    expect((justTcgHints.extra as Record<string, string> | undefined)?.variant).toBeUndefined();
    const observations = normalizeJustTcgCard(JUSTTCG_PIKACHU_MULTI_VARIANT, justTcgHints);
    expect(observations.length).toBeGreaterThan(1);

    const result = classifyCrossMatch(identity, observations);

    expect(result.outcome).toBe("ambiguous");
    expect(result.priceObservations.length).toBeGreaterThan(1);
    expect(result.warnings.some((w) => w.toLowerCase().includes("ambig"))).toBe(true);
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
