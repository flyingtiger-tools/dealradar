import { median, percentile } from "./stats";

/**
 * Signaux historiques dérivés d'observations de marché déjà persistées
 * (LOT "Multi-Source Market Intelligence Foundation") — fonctions PURES,
 * aucune I/O, aucune dépendance à `@dealradar/connectors` (même discipline
 * que le reste d'Intelligence Core : ce module ne connaît qu'un point
 * d'historique minimal, jamais le format `MarketObservation` complet —
 * l'appelant, côté `packages/ingestion`, fait la conversion).
 *
 * Règle absolue, répétée ici car c'est LE risque de ce module : la
 * disparition d'une annonce ne devient JAMAIS "vendue" — ces fonctions ne
 * reçoivent d'ailleurs aucun concept de "disparition", seulement des
 * observations réellement faites. Un historique insuffisant retourne
 * toujours `null`/`"insufficient"`, jamais une précision fabriquée.
 */

export interface HistoricalPricePoint {
  observedAt: string;
  priceCents: number;
  source: string;
}

export interface MedianRangeSignal {
  medianCents: number;
  p25Cents: number;
  p75Cents: number;
  sampleSize: number;
}

/** `null` si aucun point — jamais un "médiane 0" qui laisserait croire à une donnée réelle. */
export function computeMedianRange(points: readonly HistoricalPricePoint[]): MedianRangeSignal | null {
  if (points.length === 0) return null;
  const sorted = [...points].map((p) => p.priceCents).sort((a, b) => a - b);
  return {
    medianCents: median(sorted),
    p25Cents: percentile(sorted, 0.25),
    p75Cents: percentile(sorted, 0.75),
    sampleSize: points.length,
  };
}

export type TrendDirection = "up" | "down" | "flat" | "insufficient";

export interface TrendSignal {
  direction: TrendDirection;
  /** `null` si `direction === "insufficient"` — jamais une valeur numérique sans échantillon suffisant pour la justifier. */
  changePercent: number | null;
  windowDays: number;
  sampleSizeInWindow: number;
}

const DEFAULT_MIN_SAMPLE_PER_HALF = 2;
const FLAT_THRESHOLD_PERCENT = 3;

/**
 * Compare la moitié la plus ANCIENNE de la fenêtre à la moitié la plus
 * RÉCENTE (jamais juste le premier et le dernier point, sensibles au bruit
 * d'une seule observation aberrante). `"insufficient"` si la fenêtre ne
 * contient pas assez de points pour former deux moitiés significatives —
 * jamais une tendance devinée sur un échantillon trop petit.
 */
export function computeTrend(points: readonly HistoricalPricePoint[], asOf: string, windowDays: 7 | 30 | 90): TrendSignal {
  const windowStartMs = Date.parse(asOf) - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = points
    .filter((p) => {
      const t = Date.parse(p.observedAt);
      return !Number.isNaN(t) && t >= windowStartMs && t <= Date.parse(asOf);
    })
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  if (inWindow.length < DEFAULT_MIN_SAMPLE_PER_HALF * 2) {
    return { direction: "insufficient", changePercent: null, windowDays, sampleSizeInWindow: inWindow.length };
  }

  const midpoint = Math.floor(inWindow.length / 2);
  const earlierHalf = inWindow.slice(0, midpoint).map((p) => p.priceCents);
  const laterHalf = inWindow.slice(midpoint).map((p) => p.priceCents);
  const earlierMedian = median([...earlierHalf].sort((a, b) => a - b));
  const laterMedian = median([...laterHalf].sort((a, b) => a - b));

  if (earlierMedian === 0) {
    return { direction: "insufficient", changePercent: null, windowDays, sampleSizeInWindow: inWindow.length };
  }

  const changePercent = ((laterMedian - earlierMedian) / earlierMedian) * 100;
  const direction: TrendDirection = Math.abs(changePercent) < FLAT_THRESHOLD_PERCENT ? "flat" : changePercent > 0 ? "up" : "down";

  return { direction, changePercent, windowDays, sampleSizeInWindow: inWindow.length };
}

export interface VolatilitySignal {
  /** Coefficient de variation (écart-type / moyenne) — sans unité, comparable entre produits de prix différents. */
  coefficientOfVariation: number;
  sampleSize: number;
}

/** `null` sous 2 points — un écart-type sur un seul point n'a aucun sens statistique, jamais renvoyé comme 0. */
export function computeVolatility(points: readonly HistoricalPricePoint[]): VolatilitySignal | null {
  if (points.length < 2) return null;
  const prices = points.map((p) => p.priceCents);
  const mean = prices.reduce((sum, v) => sum + v, 0) / prices.length;
  if (mean === 0) return null;
  const variance = prices.reduce((sum, v) => sum + (v - mean) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  return { coefficientOfVariation: stdDev / mean, sampleSize: prices.length };
}

export interface ObservationSummary {
  count: number;
  sourceDiversity: number;
  /** `null` si aucun point — jamais "0h" qui laisserait croire à une observation à l'instant. */
  freshnessHours: number | null;
}

export function summarizeObservations(points: readonly HistoricalPricePoint[], asOf: string): ObservationSummary {
  if (points.length === 0) return { count: 0, sourceDiversity: 0, freshnessHours: null };

  const distinctSources = new Set(points.map((p) => p.source));
  const mostRecentMs = Math.max(...points.map((p) => Date.parse(p.observedAt)).filter((t) => !Number.isNaN(t)));
  const freshnessHours = Number.isFinite(mostRecentMs) ? (Date.parse(asOf) - mostRecentMs) / (1000 * 60 * 60) : null;

  return { count: points.length, sourceDiversity: distinctSources.size, freshnessHours };
}

/**
 * Durée pendant laquelle la MÊME annonce active a été observée (dernier
 * instantané moins premier instantané) — `timestamps` doit déjà être filtré
 * sur UNE SEULE annonce par l'appelant (cette fonction ne le vérifie pas,
 * elle n'a aucun moyen de le savoir). `null` sous 2 instantanés. Ne
 * signifie JAMAIS "vendue au bout de cette durée" — seulement "encore
 * observée active jusqu'à ce moment", conformément à la règle absolue du
 * lot (une annonce qui cesse d'être observée devient "non observée depuis",
 * jamais "vendue").
 */
export function computeActiveListingPersistenceHours(timestamps: readonly string[]): number | null {
  if (timestamps.length < 2) return null;
  const parsed = timestamps.map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t));
  if (parsed.length < 2) return null;
  const spanMs = Math.max(...parsed) - Math.min(...parsed);
  return spanMs / (1000 * 60 * 60);
}
