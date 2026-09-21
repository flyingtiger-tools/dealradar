import type { AnalysisResult, AnalysisStatus, CategorySlug } from "@dealradar/contracts";
import type { ResultViewModel, ResultPriceRow, ResultMarketInsight } from "./result-view-model";

/**
 * Mapper `AnalysisResult` (contrat universel, `@dealradar/contracts`,
 * produit par `apps/workers/src/jobs/process-analysis.ts` pour toute
 * catégorie non-TCG) → `ResultViewModel` — LOT "Universal Object Valuation
 * Foundation". Permet à `ResultScreen` (déjà entièrement construit et
 * testé pour le scan carte TCG) d'afficher un résultat d'objet quelconque
 * SANS AUCUN nouveau composant d'écran : même discipline que
 * `history/to-result-view-model.ts`, un mapper pur, jamais une deuxième
 * implémentation d'écran.
 *
 * Volontairement PAS de dépendance sur `@dealradar/core` ici (mobile ne
 * dépend aujourd'hui que de `@dealradar/contracts`, jamais du moteur
 * métier lui-même — voir ADR 0010/ADR 0013 : aucune logique métier dans le
 * mobile) — `CATEGORY_LABELS` ci-dessous est une copie minimale, PUREMENT
 * pour l'affichage (quelques libellés courts), jamais une réimplémentation
 * de `CATEGORY_PROFILES` (`packages/core`), qui reste la seule source de
 * vérité pour la logique elle-même.
 */

const CATEGORY_LABELS: Partial<Record<CategorySlug, string>> = {
  lego: "LEGO",
  pokemon_tcg: "Pokémon / TCG",
  apple: "Apple",
  gaming: "Gaming",
  photo: "Photo",
  sneakers: "Sneakers",
  watches: "Montres",
  pc_components: "PC / Composants",
  collectibles: "Objets de collection",
  general: "Objet",
};

function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[category as CategorySlug] ?? category;
}

/** Toujours 0-100 côté `AnalysisResult` (jamais 0-1, voir `analysisResultSchema` dans `@dealradar/contracts`) — jamais repassé par `toConfidencePercent` (réservé à la conversion 0-1→0-100 du flux TCG). */
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Construit les lignes de prix affichées ("Prix par source") à partir de la
 * fourchette conservatrice du moteur d'estimation — deux lignes (basse/
 * haute), jamais une valeur inventée entre les deux. `PriceHero`
 * (`deriveHeroPriceRange`, `screens/result/price-hero.ts`) prend
 * naturellement le min/max de ces lignes pour afficher la fourchette.
 */
function buildPriceRows(result: AnalysisResult): ResultPriceRow[] {
  if (!result.resaleRangeConservative) return [];
  const { low, high, currency } = result.resaleRangeConservative;
  const source = result.marketValueEstimate?.provenance ?? "estimated_value";
  const condition = result.conditionEstimated;
  const row = (amount: number): ResultPriceRow => ({
    source,
    amountCents: Math.round(amount * 100),
    currency,
    condition,
    updatedAt: null,
    convertedAmountCents: null,
    convertedCurrency: null,
  });
  return low === high ? [row(low)] : [row(low), row(high)];
}

/**
 * Traduction des `QualityFlag` (`@dealradar/core/intelligence/fuse-market-
 * observations.ts`) en libellés courts français — LOT "Data Quality
 * Calibration + Operator Observability + Mobile Market Insight Contract",
 * section 10 : "traduits en raisons courtes et lisibles humainement, jamais
 * un diagnostic technique brut". `Record<string, string>` (pas
 * `Record<QualityFlag, string>`) car `AnalysisResult.marketEvidence.
 * qualityFlags` reste un `string[]` côté contrat (`@dealradar/contracts` ne
 * dépend jamais de `@dealradar/core`, voir `analysis-result.ts`) — un flag
 * futur non encore traduit retombe sur son code brut plutôt que de
 * disparaître silencieusement.
 */
const QUALITY_FLAG_LABELS: Record<string, string> = {
  variant_conflict_filtered: "Variantes incompatibles écartées",
  stale_evidence: "Preuve de marché datée",
  retail_only: "Uniquement des prix neufs / retail",
  active_only: "Uniquement des annonces actives, aucune vente confirmée",
  low_source_diversity: "Peu de sources différentes",
  high_dispersion: "Prix très dispersés entre les sources",
  missing_condition: "État non précisé pour certaines sources",
  fx_partial: "Taux de change partiellement indisponible",
  weak_identity: "Identification du produit incertaine",
  duplicated_origin_merged: "Doublons fusionnés entre agrégateurs",
  specialist_only: "Uniquement une source spécialisée",
  sparse_history: "Historique de prix limité",
};

/**
 * Construit le résumé de preuve de marché affiché — `null` si
 * `marketEvidence` est absent (résultat produit avant ce lot, ou chemin qui
 * n'a jamais eu besoin d'enrichissement multi-source) : jamais un résumé
 * inventé à partir de champs partiels. `fairValueLow/HighCents` proviennent
 * de `resaleRangeConservative` (déjà la même fourchette que `buildPriceRows`
 * ci-dessus) — jamais une seconde fourchette recalculée ici.
 */
function buildMarketInsight(result: AnalysisResult): ResultMarketInsight | null {
  const evidence = result.marketEvidence;
  if (!evidence) return null;
  const qualityReasons = (evidence.qualityFlags ?? [])
    .map((flag) => QUALITY_FLAG_LABELS[flag] ?? flag)
    .filter((label, index, all) => all.indexOf(label) === index);
  return {
    fairValueLowCents: result.resaleRangeConservative ? Math.round(result.resaleRangeConservative.low * 100) : null,
    fairValueHighCents: result.resaleRangeConservative ? Math.round(result.resaleRangeConservative.high * 100) : null,
    currency: result.resaleRangeConservative?.currency ?? null,
    confidencePercent: clampPercent(result.confidenceScore),
    sourceCount: evidence.sourceCount,
    strongestEvidenceTier: evidence.strongestTier,
    trendDescriptor: evidence.trendDescriptor ?? null,
    trendConfidence: evidence.trendConfidence ?? null,
    retailOnlyWarning: evidence.retailOnlyWarning,
    activeListingOnlyWarning: evidence.activeListingsOnlyWarning,
    qualityReasons,
  };
}

/**
 * Un résultat n'est "identifié" que si le moteur d'extraction a produit un
 * nom de produit — même règle que `mapTcgResultToViewModel` (le signal de
 * vérité est l'identité elle-même, jamais `status` seul) : un objet
 * identifié sans assez de preuve de marché reste `identityStatus:
 * "identified"` avec `decision: "INSUFFICIENT_DATA"`, jamais un échec total.
 */
/**
 * `category` est fourni par l'appelant (jamais dérivé de
 * `result.product.category`, un champ `string | null` non garanti aligné
 * sur `categorySlugSchema`) — l'appelant connaît toujours la catégorie
 * réelle puisqu'elle a piloté `canHandle`/`createAnalysis` en amont (voir
 * `identification/generic-object-adapter.ts`). Reportée telle quelle sur
 * `ResultViewModel.category` pour que `history/from-result-view-model.ts`
 * historise sous la bonne catégorie, jamais `pokemon_tcg` par défaut.
 */
export function mapAnalysisResultToViewModel(result: AnalysisResult | null, status: AnalysisStatus, category: CategorySlug): ResultViewModel {
  if (!result || !result.product.name) {
    return {
      identityStatus: status === "failed" ? "failed" : "insufficient_data",
      category,
      product: { name: null, setName: null, collectorNumber: null, language: null, variant: null, productKind: null, gradingCompany: null, grade: null },
      confidencePercent: null,
      prices: [],
      hasPricing: false,
      warnings: result?.warnings ?? [],
      reasonMessage: result?.reasons[0] ?? (status === "failed" ? "Identification impossible avec les informations disponibles." : null),
      decision: null,
      dealScore: null,
      reasons: [],
      isDemo: false,
      marketInsight: null,
    };
  }

  return {
    identityStatus: "identified",
    category,
    product: {
      name: result.product.name,
      setName: categoryLabel(result.product.category),
      collectorNumber: result.product.modelOrReference,
      language: null,
      variant: null,
      productKind: null,
      gradingCompany: null,
      grade: null,
    },
    confidencePercent: clampPercent(result.confidenceScore),
    prices: buildPriceRows(result),
    hasPricing: result.marketValueEstimate !== null,
    warnings: result.warnings,
    reasonMessage: null,
    decision: result.decision,
    dealScore: result.dealScore,
    reasons: result.reasons,
    isDemo: false,
    marketInsight: buildMarketInsight(result),
  };
}
