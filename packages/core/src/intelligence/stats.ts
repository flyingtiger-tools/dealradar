/** Statistiques pures partagées par estimate.ts, comparables.ts et scores.ts. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

/** `sorted` doit déjà être trié croissant. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (idx - lo);
}

/**
 * Sépare les éléments aberrants par la règle IQR (1.5×) sur `getValue(item)`.
 * Désactivé sous 4 éléments : un échantillon trop petit ne permet pas de
 * distinguer une valeur aberrante d'une simple variation de marché.
 */
export function partitionOutliers<T>(
  items: T[],
  getValue: (item: T) => number,
): { kept: T[]; excluded: T[] } {
  if (items.length < 4) return { kept: items, excluded: [] };

  const sortedValues = items.map(getValue).sort((a, b) => a - b);
  const p25 = percentile(sortedValues, 0.25);
  const p75 = percentile(sortedValues, 0.75);
  const iqr = p75 - p25;
  const lowerBound = p25 - 1.5 * iqr;
  const upperBound = p75 + 1.5 * iqr;

  const kept: T[] = [];
  const excluded: T[] = [];
  for (const item of items) {
    const value = getValue(item);
    (value >= lowerBound && value <= upperBound ? kept : excluded).push(item);
  }
  return { kept, excluded };
}
