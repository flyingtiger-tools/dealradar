import { partitionOutliers, clamp } from "./stats";
import { isLikelyBundleOrPartsListing } from "./listing-quality";
import type { TrendDirection } from "./history-signals";

/**
 * Moteur de fusion multi-source V1 (LOT "Multi-Source Fusion + Source Wave
 * 1") — fonction PURE, aucune I/O, aucune dépendance à `@dealradar/
 * connectors` (même discipline de découplage que `history-signals.ts`) :
 * ce module ne connaît qu'une forme minimale d'observation
 * (`FusionObservation`), jamais `MarketObservation` (`@dealradar/
 * connectors`) directement — l'appelant (`packages/ingestion`) fait la
 * conversion, même patron déjà établi ce lot.
 *
 * Règle absolue, jamais transgressée : `soldAt` n'entre JAMAIS dans le
 * calcul comme preuve de vente au-delà du palier déjà assigné par la
 * source — ce module ne réinterprète jamais une disparition ou une
 * absence de `soldAt` comme une vente.
 */

export type EvidenceQualityTier = "A" | "B" | "C" | "D" | "E";

export interface FusionObservation {
  /** Slug de CONNECTEUR (ex. "google_shopping", "ebay") — voir `merchant` pour l'origine réelle sous-jacente. */
  source: string;
  /**
   * Origine RÉELLE (marchand/site) sous-jacente si connue et distincte du
   * connecteur (LOT "Source Wave 2", section 8) — ex. une offre syndiquée
   * via Google Shopping mais qui provient en réalité de "ebay.com" doit
   * porter `merchant: "ebay"`, pas seulement `source: "google_shopping"`.
   * `undefined`/égal à `source` = origine inconnue ou déjà le marchand
   * direct (comportement par défaut, aucune régression pour les
   * observations qui ne renseignent pas ce champ). La diversité de sources
   * utilisée pour la confiance et l'amortissement de poids se base sur
   * CE champ (avec repli sur `source`), jamais sur `source` seul — un même
   * marchand vu via deux connecteurs différents ne doit jamais compter
   * comme deux origines indépendantes.
   */
  merchant?: string;
  sourceItemId: string;
  title: string;
  priceCents: number;
  /** Doit déjà être dans la devise cible — la fusion ne convertit JAMAIS de devise elle-même (voir `FusionTarget.currency`, l'appelant normalise via le mécanisme FX existant avant d'appeler cette fonction). */
  currency: string;
  evidenceTier: EvidenceQualityTier;
  observedAt: string;
  /** 0–1. */
  matchScore: number;
  condition: string | null;
  completeness: string | null;
  /** Bag ouvert d'attributs structurels (ex. storageGb, size, generation) — comparé au `target` pour la compatibilité de variante (voir `isCompatibleWithTarget`). */
  attributes: Record<string, string | number>;
}

export interface FusionTarget {
  currency: string;
  condition?: string | null;
  completeness?: string | null;
  attributes?: Record<string, string | number>;
}

/**
 * Contexte d'historique OPTIONNEL (LOT "Data Quality Calibration...",
 * section 4) — déjà calculé par l'appelant via `computeHistoryIntelligenceV2`
 * (`history-signals-v2.ts`), jamais recalculé ici : la fusion reste pure et
 * ne lit aucun point brut d'historique, uniquement un résumé déjà réduit.
 * Sert à STABILISER un instantané live faible, jamais à prédire une
 * tendance future ni à remplacer la preuve live disponible.
 */
export interface FusionHistoryContext {
  /** `null` si aucun point d'historique n'existe encore pour ce produit. */
  historicalMedianCents: number | null;
  /** Âge en heures du point d'historique le plus récent — un historique périmé n'ancre jamais rien (voir `applyHistoryStabilization`). */
  freshnessHours: number | null;
  trendDirection: TrendDirection;
  /** 0–100, réutilisé tel quel depuis `HistoryIntelligenceV2.confidence` — jamais recalculé. */
  confidence: number;
  sampleSize: number;
}

export interface FusionOptions {
  asOf: string;
  target: FusionTarget;
  /** Demi-vie de décroissance de fraîcheur, en jours — 30 par défaut (prix de collection/électronique, pas un marché financier à haute fréquence). */
  recencyHalfLifeDays?: number;
  /** Certitude d'identité 0–1 (ex. dérivée de `IdentityHealthSummary`, `packages/core/src/identity`) — `1` = neutre/non fournie, ne peut JAMAIS augmenter la confiance au-delà de son plafond de palier, uniquement la pénaliser. */
  identityCertainty?: number;
  /** Fiabilité FX 0–1 (ex. devise déjà native, ou taux récent/fiable) — même discipline que `identityCertainty`. */
  fxReliability?: number;
  history?: FusionHistoryContext;
}

/**
 * Drapeaux de qualité DÉTERMINISTES (LOT "Data Quality Calibration...",
 * section 3) — jamais du texte libre seul : chaque drapeau a une condition
 * de déclenchement fixe et testable, exposés PAR-DESSUS `reasons` (qui
 * reste un résumé lisible, pas machine-actionnable).
 */
export type QualityFlag =
  | "variant_conflict_filtered"
  | "stale_evidence"
  | "retail_only"
  | "active_only"
  | "low_source_diversity"
  | "high_dispersion"
  | "missing_condition"
  | "fx_partial"
  | "weak_identity"
  | "duplicated_origin_merged"
  | "specialist_only"
  | "sparse_history";

/**
 * Décomposition de la confiance (LOT "Data Quality Calibration...",
 * section 2) — chaque composante est 0–1 (facteur multiplicatif ou base
 * additive selon le rôle, voir `computeConfidence`), `final` reste 0–100 et
 * IDENTIQUE à `FusedValuation.confidence`. `identity`/`fx` valent `1`
 * (neutre) quand non fournis par l'appelant — ils ne peuvent jamais faire
 * dépasser le plafond de palier (`TIER_CONFIDENCE_CAP`), uniquement le
 * pénaliser en dessous.
 */
export interface ConfidenceComponents {
  evidenceQuality: number;
  identity: number;
  diversity: number;
  freshness: number;
  depth: number;
  agreement: number;
  fx: number;
  condition: number;
  final: number;
}

export type InsufficiencyReason =
  | "NO_OBSERVATIONS"
  | "ALL_WRONG_CURRENCY"
  | "ALL_EXCLUDED_VARIANT_MISMATCH"
  | "ALL_EXCLUDED_BUNDLE_OR_PARTS"
  | "TOO_FEW_AFTER_FILTERING";

export interface EvidenceMixEntry {
  tier: EvidenceQualityTier;
  source: string;
  /** Origine réelle (voir `FusionObservation.merchant`) — égale à `source` quand l'origine sous-jacente n'est pas distincte/connue. */
  merchant: string;
  count: number;
}

export interface FusedValuation {
  status: "estimated" | "insufficient";
  lowCents: number | null;
  fairCents: number | null;
  highCents: number | null;
  currency: string;
  /** 0–100. */
  confidence: number;
  /** `null` uniquement sur `status === "insufficient"` (aucune composante n'a de sens sans preuve retenue). */
  confidenceComponents: ConfidenceComponents | null;
  evidenceCount: number;
  sourceCount: number;
  strongestTier: EvidenceQualityTier | null;
  evidenceMix: EvidenceMixEntry[];
  /** Âge de l'observation retenue la plus récente, en heures — `null` si aucune observation retenue. */
  freshnessHours: number | null;
  reasons: string[];
  insufficiencyReason: InsufficiencyReason | null;
  qualityFlags: QualityFlag[];
  /** Médiane historique fournie via `FusionOptions.history` — `null` si aucun historique fourni/disponible, jamais recalculée ici (voir `FusionHistoryContext`). */
  historicalReferenceMedianCents: number | null;
  trendDescriptor: TrendDirection | null;
  /** 0–100, réutilisé tel quel depuis `FusionOptions.history.confidence` — `null` si aucun historique fourni. */
  trendConfidence: number | null;
  /** `true` uniquement si l'historique a effectivement ancré `fairCents` (voir `applyHistoryStabilization`) — jamais un remplacement complet de la preuve live, toujours un ajustement borné. */
  historyStabilizationApplied: boolean;
}

/**
 * Poids CARDINAL par palier — DISTINCT de `evidence-tiers.ts`
 * (`@dealradar/connectors`, ordinal uniquement, "jamais utilisé comme une
 * distance numérique"). Ici, une distance numérique EST exactement ce dont
 * la fusion a besoin pour pondérer un prix. A domine largement D/E, jamais
 * une simple moyenne indifférenciée.
 */
const TIER_WEIGHT: Record<EvidenceQualityTier, number> = { A: 10, B: 6, C: 4, D: 2, E: 1 };

/**
 * Plafond de confiance par palier LE PLUS FORT présent — jamais dépassé,
 * quel que soit le volume de preuve. D=55 reprend exactement
 * `ACTIVE_LISTING_CONFIDENCE_CAP` (`pipeline.ts`) pour rester cohérent
 * avec la règle déjà en place : une preuve d'annonce active seule ne peut
 * jamais franchir le seuil BUY (60). E=35 est plus bas encore — un prix
 * neuf affiché ne doit jamais ressembler à une estimation de revente
 * fiable (règle explicite du lot).
 */
const TIER_CONFIDENCE_CAP: Record<EvidenceQualityTier, number> = { A: 100, B: 90, C: 75, D: 55, E: 35 };
const TIER_ORDER_DESC: readonly EvidenceQualityTier[] = ["A", "B", "C", "D", "E"];

const DEFAULT_RECENCY_HALF_LIFE_DAYS = 30;

function ageHours(observedAt: string, asOf: string): number | null {
  const observedMs = Date.parse(observedAt);
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(observedMs) || Number.isNaN(asOfMs)) return null;
  return Math.max(0, (asOfMs - observedMs) / (1000 * 60 * 60));
}

function recencyWeight(observedAt: string, asOf: string, halfLifeDays: number): number {
  const hours = ageHours(observedAt, asOf);
  if (hours === null) return 0;
  const halfLifeHours = halfLifeDays * 24;
  return 0.5 ** (hours / halfLifeHours);
}

/**
 * Compatibilité de variante — même philosophie que `matchComparables`
 * (`comparables.ts`) : une valeur connue des DEUX côtés qui diffère exclut
 * strictement (mauvais stockage/taille/génération/édition/région), une
 * valeur simplement ABSENTE d'un côté réduit la confiance mais n'exclut
 * jamais. Condition et complétude suivent la même règle, séparément des
 * attributs génériques (ce sont des champs dédiés de `FusionObservation`,
 * pas dans le bag `attributes`).
 */
export function isCompatibleWithTarget(observation: FusionObservation, target: FusionTarget): boolean {
  if (target.condition && observation.condition && target.condition !== observation.condition) return false;
  if (target.completeness && observation.completeness && target.completeness !== observation.completeness) return false;

  const targetAttributes = target.attributes ?? {};
  for (const [key, targetValue] of Object.entries(targetAttributes)) {
    const observedValue = observation.attributes[key];
    if (observedValue === undefined) continue;
    if (observedValue !== targetValue) return false;
  }
  return true;
}

interface WeightedObservation {
  observation: FusionObservation;
  weight: number;
}

/** Origine réelle à utiliser pour la diversité/l'amortissement — `merchant` si renseigné, sinon `source` (voir `FusionObservation.merchant`). */
function merchantOf(observation: FusionObservation): string {
  return observation.merchant ?? observation.source;
}

/** Diminution de type racine carrée par ORIGINE RÉELLE (voir `merchantOf`) — N observations d'une même origine pèsent comme environ √N observations indépendantes, jamais N (évite qu'une seule source nombreuse, ou qu'un même marchand syndiqué via plusieurs connecteurs, ne domine artificiellement le résultat). */
function applySourceDiversityDamping(weighted: WeightedObservation[]): WeightedObservation[] {
  const countByMerchant = new Map<string, number>();
  for (const { observation } of weighted) {
    const merchant = merchantOf(observation);
    countByMerchant.set(merchant, (countByMerchant.get(merchant) ?? 0) + 1);
  }
  return weighted.map(({ observation, weight }) => {
    const countFromMerchant = countByMerchant.get(merchantOf(observation)) ?? 1;
    return { observation, weight: weight / Math.sqrt(countFromMerchant) };
  });
}

/** Percentile pondéré (interpolation linéaire sur le poids cumulé) — jamais une simple moyenne, voir l'en-tête du fichier. `items` n'a pas besoin d'être trié. */
export function weightedPercentile(items: readonly { value: number; weight: number }[], p: number): number {
  const sorted = [...items].filter((i) => i.weight > 0).sort((a, b) => a.value - b.value);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!.value;

  const totalWeight = sorted.reduce((sum, i) => sum + i.weight, 0);
  const target = p * totalWeight;

  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = cumulative + sorted[i]!.weight;
    if (target <= next || i === sorted.length - 1) {
      const prevItem = sorted[Math.max(0, i - 1)]!;
      const currItem = sorted[i]!;
      const span = next - cumulative;
      const fraction = span > 0 ? (target - cumulative) / span : 0;
      return i === 0 ? currItem.value : prevItem.value + (currItem.value - prevItem.value) * fraction;
    }
    cumulative = next;
  }
  return sorted[sorted.length - 1]!.value;
}

function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

const MIN_OBSERVATIONS_FOR_ESTIMATE = 1;
/** Au-delà de ce coefficient de variation parmi le palier le plus fort, l'évidence est jugée contradictoire — pénalité de confiance plutôt qu'une moyenne silencieuse (règle explicite du lot). */
const CONTRADICTORY_EVIDENCE_CV_THRESHOLD = 0.35;

function insufficientResult(currency: string, reason: InsufficiencyReason, extraReasons: string[] = []): FusedValuation {
  return {
    status: "insufficient",
    lowCents: null,
    fairCents: null,
    highCents: null,
    currency,
    confidence: 0,
    confidenceComponents: null,
    evidenceCount: 0,
    sourceCount: 0,
    strongestTier: null,
    evidenceMix: [],
    freshnessHours: null,
    reasons: extraReasons,
    insufficiencyReason: reason,
    qualityFlags: [],
    historicalReferenceMedianCents: null,
    trendDescriptor: null,
    trendConfidence: null,
    historyStabilizationApplied: false,
  };
}

export function fuseMarketObservations(observations: readonly FusionObservation[], options: FusionOptions): FusedValuation {
  const { asOf, target } = options;
  const halfLifeDays = options.recencyHalfLifeDays ?? DEFAULT_RECENCY_HALF_LIFE_DAYS;

  if (observations.length === 0) return insufficientResult(target.currency, "NO_OBSERVATIONS");

  const rightCurrency = observations.filter((o) => o.currency === target.currency);
  if (rightCurrency.length === 0) {
    return insufficientResult(target.currency, "ALL_WRONG_CURRENCY", [
      `Aucune observation dans la devise cible ${target.currency} (${observations.length} observation(s) dans une autre devise, jamais convertie ici).`,
    ]);
  }

  const notBundleOrParts = rightCurrency.filter((o) => !isLikelyBundleOrPartsListing(o.title));
  const excludedBundleCount = rightCurrency.length - notBundleOrParts.length;

  const compatible = notBundleOrParts.filter((o) => isCompatibleWithTarget(o, target));
  const excludedVariantCount = notBundleOrParts.length - compatible.length;

  if (compatible.length === 0) {
    if (excludedVariantCount > 0) {
      return insufficientResult(target.currency, "ALL_EXCLUDED_VARIANT_MISMATCH", [
        `${excludedVariantCount} observation(s) exclue(s) pour incompatibilité de variante/état/complétude.`,
      ]);
    }
    return insufficientResult(target.currency, "ALL_EXCLUDED_BUNDLE_OR_PARTS", [
      `${excludedBundleCount} observation(s) exclue(s) comme lot/bundle/pièces détachées.`,
    ]);
  }
  if (compatible.length < MIN_OBSERVATIONS_FOR_ESTIMATE) {
    return insufficientResult(target.currency, "TOO_FEW_AFTER_FILTERING");
  }

  // Écarte les valeurs aberrantes AVANT toute pondération (réutilise
  // `partitionOutliers`, déjà testé — IQR × 1.5, désactivé sous 4 éléments)
  // — mais UNIQUEMENT au sein d'un même palier de preuve. Une comparaison
  // aberrante inter-palier serait un contresens : une seule observation A
  // qui diverge d'une masse d'observations D/E n'est PAS une aberration au
  // sens statistique, c'est exactement le signal de qualité que la
  // pondération par palier doit faire dominer (règle explicite du lot :
  // "Tier A/B can dominate D/E when high-quality evidence exists"). Un
  // filtre global l'aurait au contraire supprimée silencieusement.
  const byTier = new Map<EvidenceQualityTier, FusionObservation[]>();
  for (const o of compatible) {
    const group = byTier.get(o.evidenceTier) ?? [];
    group.push(o);
    byTier.set(o.evidenceTier, group);
  }
  const usableByTier: FusionObservation[] = [];
  const outliers: FusionObservation[] = [];
  for (const group of byTier.values()) {
    const { kept, excluded } = partitionOutliers(group, (o) => o.priceCents);
    usableByTier.push(...kept);
    outliers.push(...excluded);
  }
  // Un pool entièrement "aberrant" au sein de son palier (cas dégénéré) reste utilisable plutôt que de tout perdre.
  const usable = usableByTier.length > 0 ? usableByTier : compatible;

  const weighted: WeightedObservation[] = usable.map((observation) => ({
    observation,
    weight: TIER_WEIGHT[observation.evidenceTier] * recencyWeight(observation.observedAt, asOf, halfLifeDays) * Math.max(0, Math.min(1, observation.matchScore)),
  }));
  const damped = applySourceDiversityDamping(weighted);
  const withPositiveWeight = damped.filter((w) => w.weight > 0);

  if (withPositiveWeight.length === 0) {
    return insufficientResult(target.currency, "TOO_FEW_AFTER_FILTERING", ["Toutes les observations ont un poids nul (trop anciennes ou correspondance nulle)."]);
  }

  const items = withPositiveWeight.map((w) => ({ value: w.observation.priceCents, weight: w.weight }));
  const fairCents = Math.round(weightedPercentile(items, 0.5));
  const lowCents = Math.round(weightedPercentile(items, 0.25));
  const highCents = Math.round(weightedPercentile(items, 0.75));

  const strongestTier = TIER_ORDER_DESC.find((tier) => usable.some((o) => o.evidenceTier === tier)) ?? null;
  // Diversité par ORIGINE RÉELLE (voir `merchantOf`) — jamais par nom de connecteur seul (section 8 : un même marchand syndiqué via deux connecteurs ne doit jamais compter comme deux sources indépendantes).
  const sourceCount = new Set(usable.map((o) => merchantOf(o))).size;
  const mostRecentMs = Math.max(...usable.map((o) => Date.parse(o.observedAt)).filter((t) => !Number.isNaN(t)));
  const freshnessHours = Number.isFinite(mostRecentMs) ? Math.max(0, (Date.parse(asOf) - mostRecentMs) / (1000 * 60 * 60)) : null;

  const evidenceMix: EvidenceMixEntry[] = [];
  const mixCounts = new Map<string, EvidenceMixEntry>();
  for (const o of usable) {
    const merchant = merchantOf(o);
    // Séparateur improbable dans un slug de source/marchand, mais la valeur reconstruite vient de l'entrée elle-même (jamais re-parsée depuis la clé) — évite toute ambiguïté si un slug contenait malgré tout ce caractère.
    const key = `${o.evidenceTier} ${o.source} ${merchant}`;
    const existing = mixCounts.get(key);
    if (existing) existing.count += 1;
    else mixCounts.set(key, { tier: o.evidenceTier, source: o.source, merchant, count: 1 });
  }
  evidenceMix.push(...mixCounts.values());

  const strongestTierPricesForCv = usable.filter((o) => o.evidenceTier === strongestTier).map((o) => o.priceCents);
  const cv = coefficientOfVariation(strongestTierPricesForCv);

  // Stabilisation par historique (section 4) — BORNÉE, jamais un remplacement de la preuve live. Voir `applyHistoryStabilization`.
  const stabilization = applyHistoryStabilization({
    fairCents,
    lowCents,
    highCents,
    strongestTier,
    evidenceCount: usable.length,
    cv,
    history: options.history,
    halfLifeDays,
  });

  const { confidence, components } = computeConfidence({
    usable,
    strongestTier,
    sourceCount,
    freshnessHours,
    halfLifeDays,
    cv,
    identityCertainty: options.identityCertainty,
    fxReliability: options.fxReliability,
    historyStabilizationApplied: stabilization.applied,
    historyConfidence: options.history?.confidence ?? null,
  });

  const qualityFlags = computeQualityFlags({
    usable,
    strongestTier,
    sourceCount,
    freshnessHours,
    halfLifeDays,
    cv,
    excludedVariantCount,
    damped,
    identityCertainty: options.identityCertainty,
    fxReliability: options.fxReliability,
    history: options.history,
  });

  const reasons: string[] = [
    `${usable.length} observation(s) retenue(s) sur ${observations.length} reçue(s), palier le plus fort : ${strongestTier}.`,
    `${sourceCount} source(s) distincte(s).`,
  ];
  if (outliers.length > 0) reasons.push(`${outliers.length} valeur(s) aberrante(s) écartée(s).`);
  if (excludedVariantCount > 0) reasons.push(`${excludedVariantCount} observation(s) exclue(s) pour incompatibilité de variante.`);
  if (excludedBundleCount > 0) reasons.push(`${excludedBundleCount} observation(s) exclue(s) comme lot/bundle/pièces détachées.`);
  if (stabilization.applied) reasons.push("Historique récent utilisé pour stabiliser un instantané live faible/bruité — ajustement borné, jamais un remplacement de la preuve live.");

  return {
    status: "estimated",
    lowCents: Math.min(stabilization.lowCents, stabilization.fairCents),
    fairCents: stabilization.fairCents,
    highCents: Math.max(stabilization.highCents, stabilization.fairCents),
    currency: target.currency,
    confidence,
    confidenceComponents: components,
    evidenceCount: usable.length,
    sourceCount,
    strongestTier,
    evidenceMix,
    freshnessHours,
    reasons,
    insufficiencyReason: null,
    qualityFlags,
    historicalReferenceMedianCents: options.history?.historicalMedianCents ?? null,
    trendDescriptor: options.history?.trendDirection ?? null,
    trendConfidence: options.history?.confidence ?? null,
    historyStabilizationApplied: stabilization.applied,
  };
}

/**
 * Ancrage BORNÉ vers la médiane historique (section 4) — appliqué
 * UNIQUEMENT quand : l'historique fourni est encore frais (jamais un
 * historique périmé qui dominerait une preuve fraîche), suffisamment
 * fiable (`confidence >= 40`, même seuil que `computeHistoryConfidence`,
 * `history-signals-v2.ts`), ET la preuve live est faible (peu
 * d'observations, palier D/E, ou fortement contradictoire). Le décalage
 * est plafonné à 15 % de la valeur live — jamais un remplacement complet,
 * jamais une prédiction de tendance future.
 */
const MAX_HISTORY_SHIFT_FRACTION = 0.15;
const HISTORY_MIN_CONFIDENCE_TO_ANCHOR = 40;
const HISTORY_STALE_HALF_LIFE_MULTIPLIER = 3;

function applyHistoryStabilization(args: {
  fairCents: number;
  lowCents: number;
  highCents: number;
  strongestTier: EvidenceQualityTier | null;
  evidenceCount: number;
  cv: number | null;
  history: FusionHistoryContext | undefined;
  halfLifeDays: number;
}): { fairCents: number; lowCents: number; highCents: number; applied: boolean } {
  const { fairCents, lowCents, highCents, strongestTier, evidenceCount, cv, history, halfLifeDays } = args;
  const noChange = { fairCents, lowCents, highCents, applied: false };
  if (!history || history.historicalMedianCents === null) return noChange;
  if (history.confidence < HISTORY_MIN_CONFIDENCE_TO_ANCHOR) return noChange;

  const staleThresholdHours = halfLifeDays * 24 * HISTORY_STALE_HALF_LIFE_MULTIPLIER;
  if (history.freshnessHours === null || history.freshnessHours > staleThresholdHours) return noChange;

  const liveIsThin = evidenceCount < 3 || strongestTier === "D" || strongestTier === "E";
  const liveIsNoisy = cv !== null && cv > CONTRADICTORY_EVIDENCE_CV_THRESHOLD;
  if (!liveIsThin && !liveIsNoisy) return noChange;

  const maxShift = Math.abs(fairCents) * MAX_HISTORY_SHIFT_FRACTION;
  const delta = clamp(history.historicalMedianCents - fairCents, -maxShift, maxShift);
  const newFair = Math.round(fairCents + delta);
  return { fairCents: newFair, lowCents: Math.min(lowCents, newFair), highCents: Math.max(highCents, newFair), applied: true };
}

function computeQualityFlags(args: {
  usable: readonly FusionObservation[];
  strongestTier: EvidenceQualityTier | null;
  sourceCount: number;
  freshnessHours: number | null;
  halfLifeDays: number;
  cv: number | null;
  excludedVariantCount: number;
  damped: readonly WeightedObservation[];
  identityCertainty: number | undefined;
  fxReliability: number | undefined;
  history: FusionHistoryContext | undefined;
}): QualityFlag[] {
  const { usable, strongestTier, sourceCount, freshnessHours, halfLifeDays, cv, excludedVariantCount, damped, identityCertainty, fxReliability, history } = args;
  const flags: QualityFlag[] = [];
  const tiersPresent = new Set(usable.map((o) => o.evidenceTier));

  if (excludedVariantCount > 0) flags.push("variant_conflict_filtered");
  if (freshnessHours !== null && freshnessHours > halfLifeDays * 24 * 2) flags.push("stale_evidence");
  if (strongestTier === "E" && tiersPresent.size === 1) flags.push("retail_only");
  if (strongestTier === "D" && tiersPresent.size === 1) flags.push("active_only");
  if (sourceCount <= 1) flags.push("low_source_diversity");
  if (cv !== null && cv > CONTRADICTORY_EVIDENCE_CV_THRESHOLD) flags.push("high_dispersion");
  const knownConditionCount = usable.filter((o) => o.condition !== null).length;
  if (knownConditionCount < usable.length / 2) flags.push("missing_condition");
  if (fxReliability !== undefined && fxReliability < 1) flags.push("fx_partial");
  if (identityCertainty !== undefined && identityCertainty < 0.7) flags.push("weak_identity");
  const merchantCounts = new Map<string, number>();
  for (const { observation } of damped) merchantCounts.set(merchantOf(observation), (merchantCounts.get(merchantOf(observation)) ?? 0) + 1);
  if ([...merchantCounts.values()].some((count) => count > 1)) flags.push("duplicated_origin_merged");
  if ((strongestTier === "A" || strongestTier === "B") && !tiersPresent.has("D") && !tiersPresent.has("E")) flags.push("specialist_only");
  if (history && history.historicalMedianCents !== null && history.sampleSize < 5) flags.push("sparse_history");

  return flags;
}

function computeConfidence(args: {
  usable: readonly FusionObservation[];
  strongestTier: EvidenceQualityTier | null;
  sourceCount: number;
  freshnessHours: number | null;
  halfLifeDays: number;
  cv: number | null;
  identityCertainty: number | undefined;
  fxReliability: number | undefined;
  historyStabilizationApplied: boolean;
  historyConfidence: number | null;
}): { confidence: number; components: ConfidenceComponents } {
  const { usable, strongestTier, sourceCount, freshnessHours, halfLifeDays, cv, identityCertainty, fxReliability, historyStabilizationApplied, historyConfidence } = args;
  if (!strongestTier) {
    const empty: ConfidenceComponents = { evidenceQuality: 0, identity: 1, diversity: 0, freshness: 0, depth: 0, agreement: 1, fx: 1, condition: 1, final: 0 };
    return { confidence: 0, components: empty };
  }

  const cap = TIER_CONFIDENCE_CAP[strongestTier];

  // Volume : plus d'observations augmente la confiance, rendements décroissants (log). Saturation volontairement lente (~20 observations) pour qu'un petit échantillon typique ne sature jamais artificiellement le plafond de palier avant que la diversité/fraîcheur/accord n'aient pu le moduler.
  const volumeScore = Math.min(1, Math.log2(usable.length + 1) / Math.log2(21));

  // Diversité de sources : une seule source plafonne ce facteur, plusieurs sources indépendantes l'augmentent — jamais un simple compte brut (voir source-diversity damping déjà appliqué au poids). Saturation à 5 sources distinctes.
  const diversityScore = Math.min(1, sourceCount / 5);

  // Volume et diversité forment la base 0-100 ("combien de bonne preuve avons-nous"). Fraîcheur et accord ne sont PAS des bonus additifs fixes — ce sont des multiplicateurs qui ne font que PÉNALISER une base par ailleurs solide quand la preuve est ancienne ou contradictoire, jamais l'inverse.
  const base = 50 * volumeScore + 50 * diversityScore;

  // Fraîcheur : décroît avec l'âge de l'observation la plus récente retenue, même demi-vie que la pondération.
  const freshnessScore = freshnessHours === null ? 0.5 : 0.5 ** (freshnessHours / (halfLifeDays * 24));

  // Accord entre preuves du palier le PLUS FORT uniquement — une preuve A/B
  // qui se contredit fortement ne doit jamais être moyennée silencieusement
  // (règle explicite du lot), elle pénalise la confiance.
  const agreementScore = cv === null ? 1 : cv > CONTRADICTORY_EVIDENCE_CV_THRESHOLD ? Math.max(0, 1 - (cv - CONTRADICTORY_EVIDENCE_CV_THRESHOLD)) : 1;

  // Certitude d'identité / fiabilité FX (section 2) — `1` = neutre quand non fournies par l'appelant, ne peuvent JAMAIS dépasser le plafond de palier, uniquement le pénaliser en dessous (clampées 0–1 par sécurité contre une entrée hors bornes).
  const identityScore = identityCertainty === undefined ? 1 : clamp(identityCertainty, 0, 1);
  const fxScore = fxReliability === undefined ? 1 : clamp(fxReliability, 0, 1);

  // Certitude de condition — pénalité LÉGÈRE (jamais punitive) quand moins de la moitié des observations retenues renseignent une condition connue : un signal utile, jamais déterminant à lui seul.
  const knownConditionFraction = usable.filter((o) => o.condition !== null).length / usable.length;
  const conditionScore = knownConditionFraction >= 0.5 ? 1 : 0.9;

  // Bonus d'historique (section 4) — UNIQUEMENT quand la stabilisation a réellement ancré `fairCents` (voir `applyHistoryStabilization`), jamais un bonus pour un historique simplement présent/non appliqué. Borné à +15%, jamais assez pour dépasser le plafond de palier.
  const historyScore = historyStabilizationApplied && historyConfidence !== null ? 1 + Math.min(0.15, (historyConfidence / 100) * 0.15) : 1;

  const evidenceQuality = cap / 100;
  const combined = base * freshnessScore * agreementScore * identityScore * fxScore * conditionScore * historyScore;
  const final = Math.round(Math.min(cap, Math.max(0, combined)));

  const components: ConfidenceComponents = {
    evidenceQuality,
    identity: identityScore,
    diversity: diversityScore,
    freshness: freshnessScore,
    depth: volumeScore,
    agreement: agreementScore,
    fx: fxScore,
    condition: conditionScore,
    final,
  };

  return { confidence: final, components };
}
