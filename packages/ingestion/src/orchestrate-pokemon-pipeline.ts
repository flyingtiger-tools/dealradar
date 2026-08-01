import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogConnector, CrossMarketConversion, FxRateProvider, PricingConnector, TcgCatalogHints } from "@dealradar/connectors";
import { buildCanonicalIdentity, classifyCrossMatch, convertPriceObservation, mapToJustTcgQuery } from "@dealradar/connectors";
import { corroborateCatalogIdentity } from "./corroborate-catalog-identity";
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
  region: string;
  updatedAt: string | null;
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
  variant: string | null;
  language: string | null;
  productKind: string;
  gradingCompany: string | null;
  grade: string | null;
  /** Confiance de l'identité catalogue (corroborée par deux sources ou non). */
  confidence: number;
  /** Une entrée par (source pricing × devise) acceptée en exact_match — jamais moyennées entre elles. */
  priceObservations: PokemonPipelinePriceEntry[];
  /** Conversion indicative — produite uniquement si aucune observation n'existe déjà dans `targetCurrency`. */
  conversion: CrossMarketConversion | null;
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

  // 1. Identification catalogue — Pokémon TCG API (référence) corroborée par TCGdex (secondaire).
  const [pokemonMatches, tcgdexMatches] = await Promise.all([
    pokemonCatalogConnector.resolve({ categorySlug, hints: hints as unknown as Record<string, unknown> }),
    tcgdexCatalogConnector.resolve({ categorySlug, hints: hints as unknown as Record<string, unknown> }),
  ]);

  const corroboration = corroborateCatalogIdentity(pokemonMatches[0] ?? null, tcgdexMatches[0] ?? null);
  if (!corroboration) {
    return { stage: "catalog_no_match", candidate: null, warnings: [], reason: "Aucune carte catalogue résolue pour ces indices." };
  }
  if (corroboration.outcome === "diverged") {
    return { stage: "catalog_diverged", candidate: null, warnings: corroboration.warnings, reason: corroboration.warnings[0] };
  }

  const catalogSources = corroboration.outcome === "corroborated" ? [pokemonMatches[0]!.item.source, tcgdexMatches[0]!.item.source] : [corroboration.primary.item.source];

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

  // 3. Persistance traçable — une écriture par source ayant produit un exact_match, jamais fusionnées.
  const priceEntries: PokemonPipelinePriceEntry[] = [];
  for (const match of acceptedMatches) {
    await persistTcgPriceObservation(supabase, categorySlug, match);
    const obs = match.priceObservations[0]!;
    priceEntries.push({
      source: obs.source,
      provenance: obs.provenance,
      amountCents: obs.amountCents,
      currency: obs.currency,
      region: obs.region,
      updatedAt: obs.updatedAt,
      warnings: obs.warnings,
    });
  }

  // 4. Conversion indicative — seulement si aucune observation acceptée n'est déjà dans la devise cible
  // (LOT 7B : "ne jamais convertir un prix EUR en CHF si un prix CHF réel existe un jour").
  let conversion: CrossMarketConversion | null = null;
  const warnings: string[] = [...corroboration.warnings, ...justTcgCrossMatch.warnings, ...tcgdexCrossMatch.warnings];

  const alreadyInTargetCurrency = priceEntries.some((e) => e.currency === targetCurrency);
  if (!alreadyInTargetCurrency) {
    const sourceForConversion = acceptedMatches[0]!.priceObservations[0]!;
    const fxRate = await fxProvider.getRate(sourceForConversion.currency, targetCurrency);
    const conversionOutcome = convertPriceObservation(sourceForConversion, fxRate, { maxRateAgeHours: maxFxRateAgeHours });
    if (conversionOutcome.status === "converted") {
      await persistFxRate(supabase, fxRate!);
      conversion = conversionOutcome.conversion;
      warnings.push(conversionOutcome.conversion.warning, INDICATIVE_CONVERSION_WARNING);
    } else {
      warnings.push(`Conversion indicative impossible : ${conversionOutcome.reason}`);
    }
  }

  const primaryObservation = acceptedMatches[0]!.priceObservations[0]!;
  const candidate: PokemonPipelineCandidate = {
    categorySlug,
    catalogSources,
    catalogExternalId: identity.catalogExternalId,
    game: identity.game,
    name: identity.cardName,
    setName: identity.setName,
    cardNumber: identity.cardNumber,
    variant: primaryObservation.variant ?? identity.variant,
    language: primaryObservation.language ?? identity.language,
    productKind: identity.productKind,
    gradingCompany: primaryObservation.gradingCompany ?? identity.gradingCompany,
    grade: primaryObservation.grade ?? identity.grade,
    confidence: identity.confidence,
    priceObservations: priceEntries,
    conversion,
    provenance: [...catalogSources, ...priceEntries.map((e) => e.provenance)],
    warnings,
  };

  return { stage: "ready_for_intelligence_core", candidate, warnings };
}
