import { median, partitionOutliers } from "./stats";
import { computeMedianRange, computeVolatility, type HistoricalPricePoint, type TrendDirection, type VolatilitySignal } from "./history-signals";

/**
 * Intelligence d'historique de prix V2 (LOT "Historical Data Engine",
 * section 8) — fonctions PURES, construites SUR `history-signals.ts`
 * (jamais une réécriture : V1 reste intact et testé séparément, ses 15
 * tests ne sont jamais touchés). Compose des signaux déjà existants
 * (médiane/percentiles, tendance, volatilité) avec de nouveaux signaux
 * (position historique, supply active, diversité de sources DANS LE
 * TEMPS, confiance) sans jamais surestimer la précision d'un historique
 * peu profond — voir `computeHistoryConfidence`.
 */

export interface HistoryPointV2 extends HistoricalPricePoint {
  /** `true` uniquement pour un point représentant une annonce active ENCORE observée à `asOf` (voir `listing-lifecycle.ts`, `ListingLifecycleState.currentlySeen`) — jamais deviné, l'appelant doit le fournir explicitement. */
  isCurrentlyActiveListing?: boolean;
}

export interface TrendWindowSignal {
  windowDays: 7 | 30 | 90 | 180;
  direction: TrendDirection;
  changePercent: number | null;
  sampleSizeInWindow: number;
}

const MIN_SAMPLE_PER_HALF = 2;
const FLAT_THRESHOLD_PERCENT = 3;

/**
 * Même logique que `computeTrend` (`history-signals.ts`) mais avec une
 * fenêtre élargie à 180 jours (V1 se limite à 7|30|90, un type littéral
 * volontairement étroit pour son usage existant — jamais modifié ici pour
 * ne pas risquer sa suite de tests). Dupliquée plutôt que forcée par un
 * cast, pour rester honnête sur le fait que V1 n'a jamais supporté 180j.
 */
function computeTrendForWindow(points: readonly HistoricalPricePoint[], asOf: string, windowDays: 7 | 30 | 90 | 180): TrendWindowSignal {
  const windowStartMs = Date.parse(asOf) - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = points
    .filter((p) => {
      const t = Date.parse(p.observedAt);
      return !Number.isNaN(t) && t >= windowStartMs && t <= Date.parse(asOf);
    })
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  if (inWindow.length < MIN_SAMPLE_PER_HALF * 2) {
    return { windowDays, direction: "insufficient", changePercent: null, sampleSizeInWindow: inWindow.length };
  }

  const midpoint = Math.floor(inWindow.length / 2);
  const earlierMedian = median(inWindow.slice(0, midpoint).map((p) => p.priceCents).sort((a, b) => a - b));
  const laterMedian = median(inWindow.slice(midpoint).map((p) => p.priceCents).sort((a, b) => a - b));

  if (earlierMedian === 0) return { windowDays, direction: "insufficient", changePercent: null, sampleSizeInWindow: inWindow.length };

  const changePercent = ((laterMedian - earlierMedian) / earlierMedian) * 100;
  const direction: TrendDirection = Math.abs(changePercent) < FLAT_THRESHOLD_PERCENT ? "flat" : changePercent > 0 ? "up" : "down";
  return { windowDays, direction, changePercent, sampleSizeInWindow: inWindow.length };
}

/**
 * Proxy de liquidité DÉLIBÉRÉMENT ÉTIQUETÉ COMME TEL (instruction explicite
 * du lot : "clearly labelled proxy") — approxime la "facilité de revente"
 * à partir du renouvellement des annonces actives observées (nombre
 * d'annonces actives DISTINCTES vues dans la fenêtre / durée de la
 * fenêtre en jours), PAS une mesure de liquidité financière réelle. Jamais
 * présenté comme une vitesse de vente confirmée — aucune vente n'entre
 * dans ce calcul.
 */
export interface LiquidityProxySignal {
  /** Toujours `"proxy"` — jamais omis, pour qu'aucun consommateur ne puisse confondre ce signal avec une mesure de liquidité confirmée. */
  kind: "proxy";
  distinctActiveListingsPerDay: number;
  windowDays: number;
}

function computeLiquidityProxy(points: readonly HistoryPointV2[], asOf: string, windowDays: number): LiquidityProxySignal | null {
  const windowStartMs = Date.parse(asOf) - windowDays * 24 * 60 * 60 * 1000;
  const activeInWindow = points.filter((p) => {
    const t = Date.parse(p.observedAt);
    return p.isCurrentlyActiveListing !== undefined && !Number.isNaN(t) && t >= windowStartMs && t <= Date.parse(asOf);
  });
  if (activeInWindow.length === 0) return null;

  const distinctListingKeys = new Set(activeInWindow.map((p) => `${p.source}:${p.observedAt}`));
  return { kind: "proxy", distinctActiveListingsPerDay: distinctListingKeys.size / windowDays, windowDays };
}

export interface PriceNowVsHistorySignal {
  currentPriceCents: number;
  historicalMedianCents: number;
  /** Positif = prix actuel au-dessus de la médiane historique. */
  deltaPercent: number;
}

export interface HistoryIntelligenceV2 {
  asOf: string;
  sampleSize: number;
  medianCents: number | null;
  p25Cents: number | null;
  p75Cents: number | null;
  /** Après écart des valeurs aberrantes (voir `partitionOutliers`, `stats.ts`) — jamais le min/max brut, sensible à un seul point erroné. */
  minCents: number | null;
  maxCents: number | null;
  outlierCount: number;
  trends: TrendWindowSignal[];
  volatility: VolatilitySignal | null;
  liquidityProxy: LiquidityProxySignal | null;
  /** Nombre d'annonces actives DISTINCTES encore observées à `asOf` (voir `HistoryPointV2.isCurrentlyActiveListing`) — jamais un décompte d'annonces disparues. */
  activeSupplyCount: number;
  /** Diversité de sources sur TOUT l'historique fourni, pas seulement le dernier cycle. */
  sourceDiversityOverTime: number;
  /** Position du prix ACTUEL dans la distribution historique, 0–100 (percentile) — `null` sans prix actuel ou sans historique. */
  historicalPercentilePosition: number | null;
  priceNowVsHistory: PriceNowVsHistorySignal | null;
  /** 0–100, dérivée de la profondeur d'échantillon + fraîcheur + diversité de sources — voir `computeHistoryConfidence`. Ne surestime jamais la précision d'un historique peu profond. */
  confidence: number;
  reasons: string[];
}

function computeHistoricalPercentilePosition(points: readonly HistoricalPricePoint[], currentPriceCents: number | null): number | null {
  if (currentPriceCents === null || points.length === 0) return null;
  const sorted = points.map((p) => p.priceCents).sort((a, b) => a - b);
  const rank = sorted.filter((p) => p <= currentPriceCents).length;
  return Math.round((rank / sorted.length) * 100);
}

/**
 * Confiance 0–100 — jamais un score élevé pour un historique peu profond,
 * même si le calcul statistique "réussit" techniquement sur 2 points.
 * Composée de profondeur (log, saturation lente), fraîcheur (décroissance
 * exponentielle, demi-vie 30 jours par défaut) et diversité de sources
 * (saturation à 5 sources) — même esprit que `fuseMarketObservations`,
 * jamais un simple compte brut.
 */
function computeHistoryConfidence(sampleSize: number, freshnessHours: number | null, sourceDiversity: number): number {
  if (sampleSize === 0) return 0;
  const depthScore = Math.min(1, Math.log2(sampleSize + 1) / Math.log2(21));
  const freshnessScore = freshnessHours === null ? 0.3 : 0.5 ** (freshnessHours / (30 * 24));
  const diversityScore = Math.min(1, sourceDiversity / 5);
  return Math.round((40 * depthScore + 30 * freshnessScore + 30 * diversityScore));
}

export interface ComputeHistoryIntelligenceV2Options {
  currentPriceCents?: number | null;
  liquidityWindowDays?: number;
}

export function computeHistoryIntelligenceV2(
  points: readonly HistoryPointV2[],
  asOf: string,
  options: ComputeHistoryIntelligenceV2Options = {},
): HistoryIntelligenceV2 {
  const reasons: string[] = [];

  if (points.length === 0) {
    return {
      asOf,
      sampleSize: 0,
      medianCents: null,
      p25Cents: null,
      p75Cents: null,
      minCents: null,
      maxCents: null,
      outlierCount: 0,
      trends: [],
      volatility: null,
      liquidityProxy: null,
      activeSupplyCount: 0,
      sourceDiversityOverTime: 0,
      historicalPercentilePosition: null,
      priceNowVsHistory: null,
      confidence: 0,
      reasons: ["Aucun point d'historique disponible."],
    };
  }

  const { kept, excluded } = partitionOutliers([...points], (p) => p.priceCents);
  const usable = kept.length > 0 ? kept : points;
  if (excluded.length > 0) reasons.push(`${excluded.length} point(s) aberrant(s) écarté(s) du min/max (jamais de la médiane/percentiles, calculés sur l'échantillon complet).`);

  const medianRange = computeMedianRange(points);
  const usablePrices = usable.map((p) => p.priceCents).sort((a, b) => a - b);

  const trends = ([7, 30, 90, 180] as const).map((windowDays) => computeTrendForWindow(points, asOf, windowDays));
  const volatility = computeVolatility(points);

  const liquidityWindowDays = options.liquidityWindowDays ?? 30;
  const liquidityProxy = computeLiquidityProxy(points, asOf, liquidityWindowDays);

  const activeSupplyCount = new Set(points.filter((p) => p.isCurrentlyActiveListing === true).map((p) => `${p.source}:${p.observedAt}`)).size;
  const sourceDiversityOverTime = new Set(points.map((p) => p.source)).size;

  const mostRecentMs = Math.max(...points.map((p) => Date.parse(p.observedAt)).filter((t) => !Number.isNaN(t)));
  const freshnessHours = Number.isFinite(mostRecentMs) ? Math.max(0, (Date.parse(asOf) - mostRecentMs) / (1000 * 60 * 60)) : null;

  const currentPriceCents = options.currentPriceCents ?? null;
  const historicalPercentilePosition = computeHistoricalPercentilePosition(points, currentPriceCents);
  const priceNowVsHistory =
    currentPriceCents !== null && medianRange
      ? {
          currentPriceCents,
          historicalMedianCents: medianRange.medianCents,
          deltaPercent: medianRange.medianCents === 0 ? 0 : ((currentPriceCents - medianRange.medianCents) / medianRange.medianCents) * 100,
        }
      : null;

  const confidence = computeHistoryConfidence(points.length, freshnessHours, sourceDiversityOverTime);
  if (confidence < 40) reasons.push(`Confiance limitée (${confidence}/100) — historique peu profond, ancien, ou peu diversifié en sources, jamais présenté comme une précision plus élevée que ce que les données permettent.`);

  return {
    asOf,
    sampleSize: points.length,
    medianCents: medianRange?.medianCents ?? null,
    p25Cents: medianRange?.p25Cents ?? null,
    p75Cents: medianRange?.p75Cents ?? null,
    minCents: usablePrices[0] ?? null,
    maxCents: usablePrices[usablePrices.length - 1] ?? null,
    outlierCount: excluded.length,
    trends,
    volatility,
    liquidityProxy,
    activeSupplyCount,
    sourceDiversityOverTime,
    historicalPercentilePosition,
    priceNowVsHistory,
    confidence,
    reasons,
  };
}
