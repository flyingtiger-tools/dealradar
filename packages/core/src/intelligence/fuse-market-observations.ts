import { partitionOutliers } from "./stats";
import { isLikelyBundleOrPartsListing } from "./listing-quality";

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
  source: string;
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

export interface FusionOptions {
  asOf: string;
  target: FusionTarget;
  /** Demi-vie de décroissance de fraîcheur, en jours — 30 par défaut (prix de collection/électronique, pas un marché financier à haute fréquence). */
  recencyHalfLifeDays?: number;
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
  evidenceCount: number;
  sourceCount: number;
  strongestTier: EvidenceQualityTier | null;
  evidenceMix: EvidenceMixEntry[];
  /** Âge de l'observation retenue la plus récente, en heures — `null` si aucune observation retenue. */
  freshnessHours: number | null;
  reasons: string[];
  insufficiencyReason: InsufficiencyReason | null;
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

/** Diminution de type racine carrée par source — N observations d'une même source pèsent comme environ √N observations indépendantes, jamais N (évite qu'une seule source nombreuse domine artificiellement le résultat). */
function applySourceDiversityDamping(weighted: WeightedObservation[]): WeightedObservation[] {
  const countBySource = new Map<string, number>();
  for (const { observation } of weighted) {
    countBySource.set(observation.source, (countBySource.get(observation.source) ?? 0) + 1);
  }
  return weighted.map(({ observation, weight }) => {
    const countFromSource = countBySource.get(observation.source) ?? 1;
    return { observation, weight: weight / Math.sqrt(countFromSource) };
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
    evidenceCount: 0,
    sourceCount: 0,
    strongestTier: null,
    evidenceMix: [],
    freshnessHours: null,
    reasons: extraReasons,
    insufficiencyReason: reason,
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
  const sourceCount = new Set(usable.map((o) => o.source)).size;
  const mostRecentMs = Math.max(...usable.map((o) => Date.parse(o.observedAt)).filter((t) => !Number.isNaN(t)));
  const freshnessHours = Number.isFinite(mostRecentMs) ? Math.max(0, (Date.parse(asOf) - mostRecentMs) / (1000 * 60 * 60)) : null;

  const evidenceMix: EvidenceMixEntry[] = [];
  const mixCounts = new Map<string, number>();
  for (const o of usable) {
    const key = `${o.evidenceTier}:${o.source}`;
    mixCounts.set(key, (mixCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of mixCounts) {
    const [tier, source] = key.split(":") as [EvidenceQualityTier, string];
    evidenceMix.push({ tier, source, count });
  }

  const confidence = computeConfidence({ usable, strongestTier, sourceCount, freshnessHours, halfLifeDays });

  const reasons: string[] = [
    `${usable.length} observation(s) retenue(s) sur ${observations.length} reçue(s), palier le plus fort : ${strongestTier}.`,
    `${sourceCount} source(s) distincte(s).`,
  ];
  if (outliers.length > 0) reasons.push(`${outliers.length} valeur(s) aberrante(s) écartée(s).`);
  if (excludedVariantCount > 0) reasons.push(`${excludedVariantCount} observation(s) exclue(s) pour incompatibilité de variante.`);
  if (excludedBundleCount > 0) reasons.push(`${excludedBundleCount} observation(s) exclue(s) comme lot/bundle/pièces détachées.`);

  return {
    status: "estimated",
    lowCents: Math.min(lowCents, fairCents),
    fairCents,
    highCents: Math.max(highCents, fairCents),
    currency: target.currency,
    confidence,
    evidenceCount: usable.length,
    sourceCount,
    strongestTier,
    evidenceMix,
    freshnessHours,
    reasons,
    insufficiencyReason: null,
  };
}

function computeConfidence(args: {
  usable: readonly FusionObservation[];
  strongestTier: EvidenceQualityTier | null;
  sourceCount: number;
  freshnessHours: number | null;
  halfLifeDays: number;
}): number {
  const { usable, strongestTier, sourceCount, freshnessHours, halfLifeDays } = args;
  if (!strongestTier) return 0;

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
  const strongestTierPrices = usable.filter((o) => o.evidenceTier === strongestTier).map((o) => o.priceCents);
  const cv = coefficientOfVariation(strongestTierPrices);
  const agreementScore = cv === null ? 1 : cv > CONTRADICTORY_EVIDENCE_CV_THRESHOLD ? Math.max(0, 1 - (cv - CONTRADICTORY_EVIDENCE_CV_THRESHOLD)) : 1;

  const combined = base * freshnessScore * agreementScore;
  return Math.round(Math.min(cap, Math.max(0, combined)));
}
