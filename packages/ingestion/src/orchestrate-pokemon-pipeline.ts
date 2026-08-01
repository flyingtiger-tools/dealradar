import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogConnector, CatalogMatch, CrossMarketConversion, FxRate, FxRateProvider, PricingConnector, TcgCatalogHints } from "@dealradar/connectors";
import { buildCanonicalIdentity, classifyCrossMatch, convertPriceObservation, mapToJustTcgQuery } from "@dealradar/connectors";
import { buildSingleCatalogSourceFallback, corroborateCatalogIdentity, type CatalogCorroborationOutcome } from "./corroborate-catalog-identity";
import { persistFxRate } from "./persist-fx-rate";
import { persistTcgPriceObservation } from "./persist-tcg-price-observation";

/**
 * Orchestration bout-en-bout du pipeline Pokémon (LOT 7, révisé LOT 7B) —
 * enchaîne des briques déjà construites (LOT 1/3/5/6/7B), n'en introduit
 * aucune nouvelle. eBay/saisie utilisateur → indices d'entrée
 * (`TcgCatalogHints`, extraits en amont, hors scope) → identification
 * catalogue corroborée (Pokémon TCG API + TCGdex) → mapping exact vers
 * JustTCG et TCGdex pricing (deux sources indépendantes, jamais moyennées)
 * → conversion indicative seulement si aucun prix direct dans la devise
 * cible n'existe → persistance traçable → candidat prêt pour Intelligence
 * Core.
 *
 * Ne prend, ni ne prépare, aucune décision BUY/REVIEW/PASS : ce module
 * n'importe volontairement aucun symbole de `@dealradar/core`.
 */

export type PokemonPipelineStage =
  | "catalog_no_match"
  | "catalog_diverged"
  | "cross_match_refused"
  | "ready_for_intelligence_core";

export interface PokemonPipelinePriceEntry {
  source: string;
  provenance: string;
  amountCents: number;
  currency: string;
  condition: string | null;
  variant: string | null;
  language: string | null;
  gradingCompany: string | null;
  grade: string | null;
  region: string;
  updatedAt: string | null;
  /**
   * Conversion indicative vers `targetCurrency` — calculée pour CHAQUE
   * observation dont la devise diffère de la cible, même si une autre
   * observation existe déjà nativement dans cette devise (une observation
   * CHF native n'empêche jamais la conversion indicative des autres devises
   * — utile pour comparaison/Intelligence Core). `null` seulement si déjà
   * native dans `targetCurrency`, ou si la conversion a été refusée (taux
   * absent/trop ancien — voir `warnings` du candidat).
   */
  conversion: CrossMarketConversion | null;
  warnings: string[];
}

export interface PokemonPipelineCandidate {
  categorySlug: string;
  /** Toutes les sources catalogue ayant contribué à l'identité — jamais résumées en une seule. */
  catalogSources: string[];
  catalogExternalId: string;
  game: string;
  name: string;
  setName: string | null;
  cardNumber: string | null;
  /**
   * Variante commune à TOUTES les observations acceptées, ou `null` si elle
   * n'a pas pu être fixée par l'identité ET que plusieurs variantes
   * distinctes coexistent parmi les observations (ex. Holo + Reverse Holo
   * non départagées) — jamais une valeur arbitraire choisie parmi les
   * observations. Voir `priceObservations` pour le détail segmenté par
   * variante et `warnings` pour le signal explicite d'ambiguïté.
   */
  variant: string | null;
  language: string | null;
  productKind: string;
  /** Même logique que `variant` : `null` si plusieurs sociétés de grading distinctes coexistent sans grade/société fixé par l'identité. */
  gradingCompany: string | null;
  /** Même logique que `variant` : `null` si plusieurs grades distincts coexistent sans grade fixé par l'identité (ex. PSA 9 + PSA 10 non départagés). */
  grade: string | null;
  /**
   * Confiance de l'identité catalogue (corroborée par deux sources ou non)
   * — indépendante du nombre de sources tarifaires ou de leur cohérence
   * entre elles. Plusieurs observations de prix, convergentes ou non, ne
   * modifient jamais cette valeur.
   */
  confidence: number;
  /** `single_catalog_source` : le catalogue principal était indisponible, jamais une corroboration silencieuse. Plafonne `confidence` à 0.5 en amont — ne peut donc jamais produire `exact_match` (voir `classifyCrossMatch`), ni atteindre ce candidat autrement qu'en `probable_match` refusé plus haut. */
  catalogCorroboration: CatalogCorroborationOutcome;
  /** Une entrée par (source pricing × segment) acceptée en exact_match — jamais moyennées entre elles. */
  priceObservations: PokemonPipelinePriceEntry[];
  provenance: string[];
  warnings: string[];
}

export interface OrchestratePokemonPipelineResult {
  stage: PokemonPipelineStage;
  candidate: PokemonPipelineCandidate | null;
  warnings: string[];
  reason?: string;
}

export interface OrchestratePokemonPipelineInput {
  supabase: SupabaseClient;
  /** Catalog Connector principal — Pokémon TCG API, identité de référence. */
  pokemonCatalogConnector: CatalogConnector;
  /** Catalog Connector secondaire — TCGdex, corrobore l'identité, jamais un remplacement (LOT 7B). */
  tcgdexCatalogConnector: CatalogConnector;
  /** Pricing Connector — référence nord-américaine USD. */
  justTcgPricingConnector: PricingConnector;
  /** Pricing Connector — Cardmarket EUR + TCGPlayer USD (LOT 7B). */
  tcgdexPricingConnector: PricingConnector;
  fxProvider: FxRateProvider;
  categorySlug: string;
  hints: TcgCatalogHints;
  targetCurrency: string;
  /** Au-delà de cet âge, un taux de conversion de secours est refusé — voir `convertPriceObservation`. */
  maxFxRateAgeHours?: number;
}

const INDICATIVE_CONVERSION_WARNING =
  "Conversion indicative — ne constitue jamais une décision d'achat/vente ni un prix de marché suisse ou européen confirmé.";
const DEFAULT_MAX_FX_RATE_AGE_HOURS = 48;

/** Message lisible depuis une erreur de connecteur — jamais une pile brute exposée dans un avertissement. */
function describeConnectorFailure(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

interface SharedFieldResolution {
  value: string | null;
  /** `true` si plusieurs valeurs distinctes coexistent — `value` est alors `null`, jamais un choix arbitraire. */
  ambiguous: boolean;
  distinctValues: string[];
}

/**
 * Résout un champ censé être commun à toutes les observations acceptées
 * (variante, langue, société de grading, grade) — `null` si aucune donnée,
 * la valeur si toutes s'accordent, `ambiguous: true` (et `value: null`) si
 * plusieurs valeurs distinctes coexistent. Ne choisit jamais arbitrairement
 * la première observation : un candidat ne doit jamais laisser croire que
 * toutes ses `priceObservations` portent sur une seule variante/un seul
 * grade quand ce n'est pas le cas (voir `priceObservations` pour le détail
 * segmenté).
 */
function resolveSharedField(values: (string | null)[]): SharedFieldResolution {
  const distinctValues = [...new Set(values.filter((v): v is string => v !== null))];
  if (distinctValues.length === 0) return { value: null, ambiguous: false, distinctValues };
  if (distinctValues.length === 1) return { value: distinctValues[0]!, ambiguous: false, distinctValues };
  return { value: null, ambiguous: true, distinctValues };
}

export async function orchestratePokemonPipeline(input: OrchestratePokemonPipelineInput): Promise<OrchestratePokemonPipelineResult> {
  const {
    supabase,
    pokemonCatalogConnector,
    tcgdexCatalogConnector,
    justTcgPricingConnector,
    tcgdexPricingConnector,
    fxProvider,
    categorySlug,
    hints,
    targetCurrency,
  } = input;
  const maxFxRateAgeHours = input.maxFxRateAgeHours ?? DEFAULT_MAX_FX_RATE_AGE_HOURS;

  // 1. Identification catalogue — Pokémon TCG API (référence) corroborée par
  // TCGdex (secondaire). `allSettled`, jamais `all` : une panne du catalogue
  // principal (5xx après retries, timeout réseau) ne doit jamais faire
  // planter tout le pipeline — voir le repli `single_catalog_source`
  // ci-dessous, jamais une correspondance inventée à sa place.
  const [pokemonSettled, tcgdexSettled] = await Promise.allSettled([
    pokemonCatalogConnector.resolve({ categorySlug, hints: hints as unknown as Record<string, unknown> }),
    tcgdexCatalogConnector.resolve({ categorySlug, hints: hints as unknown as Record<string, unknown> }),
  ]);

  const tcgdexMatches = tcgdexSettled.status === "fulfilled" ? tcgdexSettled.value : [];

  let corroboration: ReturnType<typeof corroborateCatalogIdentity> | ReturnType<typeof buildSingleCatalogSourceFallback>;
  let pokemonMatches: CatalogMatch[] = [];

  if (pokemonSettled.status === "rejected") {
    const tcgdexBest = tcgdexMatches[0] ?? null;
    if (!tcgdexBest) {
      return {
        stage: "catalog_no_match",
        candidate: null,
        warnings: [],
        reason: `Catalogue principal (Pokémon TCG API) indisponible (${describeConnectorFailure(pokemonSettled.reason)}) et aucune carte TCGdex résolue.`,
      };
    }
    corroboration = buildSingleCatalogSourceFallback(tcgdexBest, describeConnectorFailure(pokemonSettled.reason));
  } else {
    pokemonMatches = pokemonSettled.value;
    corroboration = corroborateCatalogIdentity(pokemonMatches[0] ?? null, tcgdexMatches[0] ?? null);
  }

  if (!corroboration) {
    return { stage: "catalog_no_match", candidate: null, warnings: [], reason: "Aucune carte catalogue résolue pour ces indices." };
  }
  if (corroboration.outcome === "diverged") {
    return { stage: "catalog_diverged", candidate: null, warnings: corroboration.warnings, reason: corroboration.warnings[0] };
  }

  const catalogSources =
    corroboration.outcome === "corroborated" ? [pokemonMatches[0]!.item.source, tcgdexMatches[0]!.item.source] : [corroboration.primary.item.source];

  // 2. Mapping exact vers chaque source de pricing — indépendamment, jamais mélangées dans une seule corroboration.
  const identity = buildCanonicalIdentity(corroboration.primary, hints);

  const justTcgQuery = mapToJustTcgQuery(identity);
  const [justTcgObservations, tcgdexObservations] = await Promise.all([
    justTcgPricingConnector.lookup(justTcgQuery),
    tcgdexPricingConnector.lookup({ categorySlug, hints: hints as unknown as Record<string, unknown> }),
  ]);

  const justTcgCrossMatch = classifyCrossMatch(identity, justTcgObservations);
  const tcgdexCrossMatch = classifyCrossMatch(identity, tcgdexObservations);

  const acceptedMatches = [justTcgCrossMatch, tcgdexCrossMatch].filter((m) => m.outcome === "exact_match");

  if (acceptedMatches.length === 0) {
    return {
      stage: "cross_match_refused",
      candidate: null,
      warnings: [...corroboration.warnings, ...justTcgCrossMatch.warnings, ...tcgdexCrossMatch.warnings],
      reason: "Aucune source de pricing n'a produit d'exact_match — jamais exploité automatiquement.",
    };
  }

  // 3. Persistance traçable — une écriture par observation acceptée (une
  // identité confirmée peut légitimement porter plusieurs observations :
  // devises différentes, conditions différentes, sources différentes — LOT
  // 7C), jamais fusionnées ni moyennées entre elles.
  const allAcceptedObservations = acceptedMatches.flatMap((match) => match.priceObservations);
  for (const match of acceptedMatches) {
    await persistTcgPriceObservation(supabase, categorySlug, match);
  }

  // 4. Conversion indicative — CHAQUE observation dont la devise diffère de
  // `targetCurrency` reçoit sa propre conversion indicative, MÊME si une
  // autre observation existe déjà nativement dans cette devise : une
  // observation CHF native n'empêche jamais la conversion indicative des
  // autres devises (utile pour comparaison/Intelligence Core) — révision de
  // la règle LOT 7B qui bloquait toute conversion dès qu'une observation
  // native existait. Les observations natives elles-mêmes ne sont jamais
  // modifiées (`conversion: null`) : aucune conversion d'une devise vers
  // elle-même.
  const warnings: string[] = [...corroboration.warnings, ...justTcgCrossMatch.warnings, ...tcgdexCrossMatch.warnings];
  const rateByCurrency = new Map<string, FxRate | null>();
  const currencyAlreadyReported = new Set<string>();
  const priceEntries: PokemonPipelinePriceEntry[] = [];

  for (const obs of allAcceptedObservations) {
    let conversion: CrossMarketConversion | null = null;
    if (obs.currency !== targetCurrency) {
      if (!rateByCurrency.has(obs.currency)) {
        rateByCurrency.set(obs.currency, await fxProvider.getRate(obs.currency, targetCurrency));
      }
      const fxRate = rateByCurrency.get(obs.currency) ?? null;
      const conversionOutcome = convertPriceObservation(obs, fxRate, { maxRateAgeHours: maxFxRateAgeHours });
      if (conversionOutcome.status === "converted") {
        conversion = conversionOutcome.conversion;
        if (!currencyAlreadyReported.has(obs.currency)) {
          await persistFxRate(supabase, fxRate!);
          warnings.push(conversionOutcome.conversion.warning);
          currencyAlreadyReported.add(obs.currency);
        }
      } else if (!currencyAlreadyReported.has(obs.currency)) {
        warnings.push(`Conversion indicative impossible (${obs.currency} → ${targetCurrency}) : ${conversionOutcome.reason}`);
        currencyAlreadyReported.add(obs.currency);
      }
    }
    priceEntries.push({
      source: obs.source,
      provenance: obs.provenance,
      amountCents: obs.amountCents,
      currency: obs.currency,
      condition: obs.condition,
      variant: obs.variant,
      language: obs.language,
      gradingCompany: obs.gradingCompany,
      grade: obs.grade,
      region: obs.region,
      updatedAt: obs.updatedAt,
      conversion,
      warnings: obs.warnings,
    });
  }
  if (priceEntries.some((e) => e.conversion !== null)) warnings.push(INDICATIVE_CONVERSION_WARNING);

  // 5. Champs communs au candidat — résolus uniquement quand TOUTES les
  // observations acceptées s'accordent ; jamais une valeur arbitraire
  // choisie parmi elles. Une carte encore ambiguë sur la variante ou le
  // grade (ex. Holo + Reverse Holo, PSA 9 + PSA 10 non départagés) reste
  // `null` ici — le détail segmenté par observation reste disponible dans
  // `priceObservations`, jamais transformé en une estimation unique.
  const variantResolution = resolveSharedField(allAcceptedObservations.map((o) => o.variant));
  const languageResolution = resolveSharedField(allAcceptedObservations.map((o) => o.language));
  const gradingCompanyResolution = resolveSharedField(allAcceptedObservations.map((o) => o.gradingCompany));
  const gradeResolution = resolveSharedField(allAcceptedObservations.map((o) => o.grade));

  if (variantResolution.ambiguous) {
    warnings.push(
      `Plusieurs variantes observées sans variante fixée par l'identité (${variantResolution.distinctValues.join(", ")}) — non résolu en une seule variante, voir priceObservations pour le détail segmenté.`,
    );
  }
  if (languageResolution.ambiguous) {
    warnings.push(
      `Plusieurs langues observées sans langue fixée par l'identité (${languageResolution.distinctValues.join(", ")}) — non résolu en une seule langue, voir priceObservations pour le détail segmenté.`,
    );
  }
  if (gradingCompanyResolution.ambiguous) {
    warnings.push(
      `Plusieurs sociétés de grading observées sans société fixée par l'identité (${gradingCompanyResolution.distinctValues.join(", ")}) — non résolu, voir priceObservations pour le détail segmenté.`,
    );
  }
  if (gradeResolution.ambiguous) {
    warnings.push(
      `Plusieurs grades observés sans grade fixé par l'identité (${gradeResolution.distinctValues.join(", ")}) — non résolu en un seul grade, voir priceObservations pour le détail segmenté.`,
    );
  }

  const candidate: PokemonPipelineCandidate = {
    categorySlug,
    catalogSources,
    catalogExternalId: identity.catalogExternalId,
    game: identity.game,
    name: identity.cardName,
    setName: identity.setName,
    cardNumber: identity.cardNumber,
    variant: variantResolution.value ?? identity.variant,
    language: languageResolution.value ?? identity.language,
    productKind: identity.productKind,
    gradingCompany: gradingCompanyResolution.value ?? identity.gradingCompany,
    grade: gradeResolution.value ?? identity.grade,
    confidence: identity.confidence,
    catalogCorroboration: corroboration.outcome,
    priceObservations: priceEntries,
    provenance: [...catalogSources, ...priceEntries.map((e) => e.provenance)],
    warnings,
  };

  return { stage: "ready_for_intelligence_core", candidate, warnings };
}
