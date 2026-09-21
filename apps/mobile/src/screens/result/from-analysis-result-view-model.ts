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
 * Calibration..." section 10, revue de copie LOT "Interactive History +
 * Generic Result UI + Full Cancellation + Pre-Prod Activation Package",
 * section 9 : français naturel et court, jamais de jargon technique
 * ("Tier"), distingue explicitement "annonces en cours" / "ventes
 * confirmées" / "historique spécialisé" / "prix neuf" plutôt qu'un vocabulaire
 * générique unique. `Record<string, string>` (pas `Record<QualityFlag,
 * string>`) car `AnalysisResult.marketEvidence.qualityFlags` reste un
 * `string[]` côté contrat (`@dealradar/contracts` ne dépend jamais de
 * `@dealradar/core`, voir `analysis-result.ts`) — un flag futur non encore
 * traduit retombe sur son code brut plutôt que de disparaître silencieusement.
 */
const QUALITY_FLAG_LABELS: Record<string, string> = {
  variant_conflict_filtered: "Certaines annonces ne correspondaient pas exactement (écartées)",
  stale_evidence: "Données de marché un peu anciennes",
  retail_only: "Basé uniquement sur des prix neufs en boutique",
  active_only: "Basé sur des annonces en cours, aucune vente confirmée",
  low_source_diversity: "Peu de sources différentes consultées",
  high_dispersion: "Les prix varient beaucoup d'une source à l'autre",
  missing_condition: "État non précisé pour certaines annonces",
  fx_partial: "Conversion de devise partiellement fiable",
  weak_identity: "Identification du produit encore incertaine",
  duplicated_origin_merged: "Annonces en double regroupées",
  specialist_only: "Basé uniquement sur un historique spécialisé",
  sparse_history: "Peu d'historique de prix disponible",
};

/**
 * Libellés d'ordre de preuve (LOT "Interactive History...", section 9) —
 * copie minimale, PUREMENT pour l'affichage, de `EVIDENCE_TIER_LABELS`
 * (`@dealradar/connectors/market-intelligence/evidence-tiers.ts`) : mobile
 * ne dépend jamais de `@dealradar/connectors` (même discipline que
 * `CATEGORY_LABELS` ci-dessus). Jamais "Tier A/B/C/D/E" affiché — toujours
 * ce libellé, ou le code brut en dernier repli pour un palier futur non
 * encore traduit plutôt qu'un affichage vide.
 */
const EVIDENCE_TIER_LABELS: Record<string, string> = {
  A: "Vente confirmée",
  B: "Historique spécialisé",
  C: "Marché en direct (achat/vente)",
  D: "Annonce en cours",
  E: "Prix neuf affiché",
};

/**
 * Libellés de tendance (LOT "Interactive History...", section 9) — décrit
 * un comportement RÉCENT déjà observé, jamais une prédiction ("tendance
 * récente à la hausse", jamais "va monter" / "va baisser").
 */
const TREND_LABELS: Record<string, string> = {
  up: "Tendance récente à la hausse",
  down: "Tendance récente à la baisse",
  flat: "Tendance récente stable",
  insufficient: "Historique insuffisant pour une tendance",
};

/**
 * Traduit `currentVsHistoryPercentile` en phrase naturelle — jamais le mot
 * "percentile" affiché à l'utilisateur (jargon statistique, LOT "Interactive
 * History...", section 9). Seuils volontairement larges (20/80) : jamais une
 * fausse précision sur une position statistique approximative.
 */
function describeHistoryPosition(percentile: number): string {
  if (percentile <= 20) return "Ce prix se situe parmi les plus bas observés historiquement";
  if (percentile >= 80) return "Ce prix se situe parmi les plus élevés observés historiquement";
  return "Ce prix se situe dans la moyenne de l'historique connu";
}

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
    strongestEvidenceLabel: evidence.strongestTier ? (EVIDENCE_TIER_LABELS[evidence.strongestTier] ?? evidence.strongestTier) : null,
    trendDescriptor: evidence.trendDescriptor ?? null,
    trendLabel: evidence.trendDescriptor ? (TREND_LABELS[evidence.trendDescriptor] ?? evidence.trendDescriptor) : null,
    trendConfidence: evidence.trendConfidence ?? null,
    retailOnlyWarning: evidence.retailOnlyWarning,
    activeListingOnlyWarning: evidence.activeListingsOnlyWarning,
    currentVsHistoryPercentile: evidence.currentVsHistoryPercentile ?? null,
    currentVsHistoryLabel: evidence.currentVsHistoryPercentile !== undefined && evidence.currentVsHistoryPercentile !== null ? describeHistoryPosition(evidence.currentVsHistoryPercentile) : null,
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
