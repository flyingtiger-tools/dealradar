import type { CatalogMatch, NormalizedPriceObservation, PricingQuery } from "../types";
import type { TcgCatalogHints } from "../catalogs/tcg/types";
import type { TcgCanonicalIdentity, TcgCrossMatchResult } from "./types";

/**
 * Mapping Pokémon TCG API (Catalog) ↔ JustTCG (Pricing) — ADR 0012, LOT 3.
 *
 * Ce module ne calcule ni ne persiste aucun prix : il prouve seulement
 * qu'une identité résolue par le Catalog Connector peut être reliée sans
 * ambiguïté à une observation de prix JustTCG. `exact_match` est la seule
 * issue jamais destinée à alimenter le moteur plus tard ; `probable_match`
 * reste informatif ; `ambiguous`/`no_match` ne produisent jamais de prix
 * exploitable automatiquement (voir `classifyCrossMatch`).
 */

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase();
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/**
 * `CatalogMatch` (déjà résolu par le Catalog Connector Pokémon) + indices
 * d'origine (variant/langue, que le catalogue Pokémon ne porte pas
 * lui-même) → identité canonique. Rien n'est deviné : un champ absent des
 * deux sources reste `null`.
 */
export function buildCanonicalIdentity(catalogMatch: CatalogMatch, hints: TcgCatalogHints): TcgCanonicalIdentity {
  const item = catalogMatch.item;
  const isGraded = Boolean(hints.gradingCompany || hints.grade || hints.kind === "graded_card");
  // Le catalogue Pokémon ne résout que l'identité de l'impression (toujours
  // "raw_card" de son point de vue) : le kind réel de l'exemplaire physique
  // (gradé, scellé…) vient des indices d'origine, jamais du catalogue.
  const productKind = hints.kind ?? (isGraded ? "graded_card" : "raw_card");
  const setName = item.canonicalAttributes.setName;
  const setCode = item.canonicalAttributes.setId;
  const cardNumber = item.canonicalAttributes.collectorNumber;

  // Un champ n'est traité comme confirmé que si le Catalog Connector l'a
  // réellement corroboré (`matchedOn`) — jamais parce que la carte résolue
  // le possède techniquement. Un "nom seul" côté catalogue (matchedOn=["name"])
  // ne doit jamais se transformer en set/numéro implicitement confirmés ici :
  // c'est ce qui fait tomber la règle "refus automatique : nom seul" plus bas.
  const setConfirmed = catalogMatch.matchedOn.includes("setName") || catalogMatch.matchedOn.includes("setCode");
  const numberConfirmed = catalogMatch.matchedOn.includes("collectorNumber");

  return {
    game: "pokemon",
    setName: setConfirmed && typeof setName === "string" ? setName : null,
    setCode: setConfirmed && typeof setCode === "string" ? setCode : null,
    cardName: item.name,
    cardNumber: numberConfirmed && typeof cardNumber === "string" ? cardNumber : null,
    variant: hints.extra?.variant ?? hints.extra?.printing ?? null,
    language: hints.language ?? null,
    productKind,
    isGraded,
    gradingCompany: hints.gradingCompany ?? null,
    grade: hints.grade ?? null,
    catalogSource: item.source,
    catalogExternalId: item.externalId,
    confidence: catalogMatch.confidence,
    warnings: [],
  };
}

/** Identité canonique → requête JustTCG. Aucun champ inventé : les `undefined` restent absents de la requête. */
export function mapToJustTcgQuery(identity: TcgCanonicalIdentity): PricingQuery {
  const hints: TcgCatalogHints = {
    kind: identity.isGraded ? "graded_card" : "raw_card",
    name: identity.cardName,
    setName: identity.setName ?? undefined,
    setCode: identity.setCode ?? undefined,
    collectorNumber: identity.cardNumber ?? undefined,
    language: identity.language ?? undefined,
    gradingCompany: identity.gradingCompany ?? undefined,
    grade: identity.grade ?? undefined,
    extra: identity.variant ? { variant: identity.variant } : undefined,
  };
  return { categorySlug: "pokemon_tcg", hints: hints as unknown as Record<string, unknown> };
}

type CorroborationResult = { ok: true } | { ok: false; reason: string };

/**
 * Un candidat ne "corrobore" l'identité que s'il concorde strictement sur
 * tous les champs connus des deux côtés — un seul désaccord l'exclut
 * entièrement. Jamais de substitution : brut ↔ gradé, une variante pour une
 * autre, ou une langue pour une autre ne sont jamais tolérés.
 */
function corroborates(identity: TcgCanonicalIdentity, obs: NormalizedPriceObservation): CorroborationResult {
  if (identity.setName && obs.setName && !sameText(identity.setName, obs.setName)) return { ok: false, reason: "set" };
  if (identity.setCode && obs.setId && !sameText(identity.setCode, obs.setId)) return { ok: false, reason: "set" };
  if (identity.cardNumber && obs.number && !sameText(identity.cardNumber, obs.number)) return { ok: false, reason: "number" };
  if (identity.variant && obs.variant && !sameText(identity.variant, obs.variant)) return { ok: false, reason: "variant" };

  const obsIsGraded = obs.gradingCompany !== null;
  if (identity.isGraded !== obsIsGraded) return { ok: false, reason: "raw_vs_graded" };

  if (identity.isGraded) {
    if (identity.gradingCompany && obs.gradingCompany && !sameText(identity.gradingCompany, obs.gradingCompany)) {
      return { ok: false, reason: "grading_company" };
    }
    if (identity.grade && obs.grade) {
      const canonicalGuess = `${identity.gradingCompany ?? ""} ${identity.grade}`.trim();
      const matchesCanonical = sameText(canonicalGuess, obs.grade);
      const matchesLoosely = normalizeForCompare(obs.grade).includes(normalizeForCompare(String(identity.grade)));
      if (!matchesCanonical && !matchesLoosely) return { ok: false, reason: "grade" };
    }
  }

  // Langue : jamais d'équivalence silencieuse FR/EN/JP — un désaccord explicite exclut le candidat.
  if (identity.language && obs.language && !sameText(identity.language, obs.language)) return { ok: false, reason: "language" };

  return { ok: true };
}

/**
 * Classification explicite de la correspondance croisée — `exact_match` est
 * la seule issue destinée à alimenter le moteur plus tard (pas encore
 * branché dans ce lot). `ambiguous`/`no_match` ne produisent jamais de prix
 * exploitable automatiquement.
 */
export function classifyCrossMatch(identity: TcgCanonicalIdentity, observations: NormalizedPriceObservation[]): TcgCrossMatchResult {
  const warnings = [...identity.warnings];
  const hasSet = Boolean(identity.setName || identity.setCode);
  const hasNumber = Boolean(identity.cardNumber);

  // Refus absolu : nom seul (aucun set, aucun numéro) — jamais de correspondance sur ce seul indice.
  if (!hasSet && !hasNumber) {
    return {
      outcome: "no_match",
      identity,
      priceObservations: [],
      confidence: 0,
      warnings: [...warnings, "Refus : nom seul insuffisant — set et numéro requis pour une correspondance."],
    };
  }

  // Refus : produit scellé — cette correspondance ne couvre que raw_card/graded_card.
  if (identity.productKind !== "raw_card" && identity.productKind !== "graded_card") {
    return {
      outcome: "no_match",
      identity,
      priceObservations: [],
      confidence: 0,
      warnings: [...warnings, `Refus : produit scellé ("${identity.productKind}") non supporté par cette correspondance.`],
    };
  }

  if (observations.length === 0) {
    return {
      outcome: "no_match",
      identity,
      priceObservations: [],
      confidence: 0,
      warnings: [...warnings, "Refus : aucun prix JustTCG disponible pour cette identité."],
    };
  }

  const checked = observations.map((o) => ({ observation: o, check: corroborates(identity, o) }));
  const corroborated = checked.filter((c): c is { observation: NormalizedPriceObservation; check: { ok: true } } => c.check.ok).map((c) => c.observation);

  if (corroborated.length === 0) {
    const reasons = [...new Set(checked.map((c) => (c.check.ok ? null : c.check.reason)).filter((r): r is string => r !== null))];
    return {
      outcome: "no_match",
      identity,
      priceObservations: [],
      confidence: 0,
      warnings: [...warnings, `Refus : aucun résultat JustTCG ne corrobore l'identité catalogue (${reasons.join(", ") || "désaccord"}).`],
    };
  }

  if (corroborated.length > 1) {
    return {
      outcome: "ambiguous",
      identity,
      priceObservations: corroborated,
      confidence: Math.max(...corroborated.map((o) => o.confidence)),
      warnings: [...warnings, "Refus : correspondance ambiguë — plusieurs candidats JustTCG équivalents après corroboration stricte, décision automatique impossible."],
    };
  }

  const match = corroborated[0]!;

  // Langue : avertissement explicite (jamais un refus) quand une seule des deux sources la fournit.
  let languageWarning: string | null = null;
  if (identity.language && !match.language) {
    languageWarning = `Langue "${identity.language}" demandée, non fournie par JustTCG pour cette variante — non vérifiable.`;
  } else if (!identity.language && match.language) {
    languageWarning = `Langue JustTCG ("${match.language}") non confirmée côté catalogue — non vérifiable.`;
  }
  if (languageWarning) warnings.push(languageWarning);

  const strongMatch =
    hasSet &&
    hasNumber &&
    identity.confidence === 1 &&
    match.confidence === 1 &&
    !match.warnings.some((w) => w.toLowerCase().includes("ambig"));

  const confidence = strongMatch ? 1 : Math.min(match.confidence, identity.confidence);

  return {
    outcome: strongMatch && !languageWarning ? "exact_match" : "probable_match",
    identity,
    priceObservations: [match],
    confidence,
    warnings,
  };
}
