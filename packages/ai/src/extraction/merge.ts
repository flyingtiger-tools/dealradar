import { extractedProductSchema, type ExtractedProduct } from "../validation/schemas";
import type { ExtractionWarning, SourcedExtraction } from "../types";

const CONTRADICTION_PENALTY = 0.3;
const MAJOR_CONTRADICTION_CONFIDENCE = 0.2;

type FieldEntry = { value: unknown; confidence: number; source: string; evidence?: string } | null;

const TOP_LEVEL_FIELDS = [
  "brand",
  "model",
  "reference",
  "category",
  "subcategory",
  "condition",
  "language",
  "color",
  "capacity",
  "accessories",
] as const;

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * Fusionne les entrées d'un même champ à travers toutes les sources.
 * Priorité pilotée par confiance, jamais "l'existant gagne" par défaut —
 * une valeur eBay brute faiblement confiante ne peut jamais écraser une
 * valeur IA fortement confirmée puisque le gagnant est toujours celui qui a
 * la confiance la plus haute quand les sources ne s'accordent pas.
 */
function mergeField(entries: FieldEntry[], key: string, isCritical: boolean, warnings: ExtractionWarning[]): FieldEntry {
  const present = entries.filter((e): e is NonNullable<FieldEntry> => e !== null);
  const [first, ...rest] = present;
  if (!first) return null;
  if (rest.length === 0) return first;

  const allAgree = present.every((e) => valuesEqual(e.value, first.value));
  const winner = present.reduce((best, current) => (current.confidence > best.confidence ? current : best), first);

  if (allAgree) {
    return { ...winner, confidence: Math.max(...present.map((e) => e.confidence)) };
  }

  if (isCritical) {
    warnings.push({
      code: "MAJOR_CONTRADICTION",
      message: `Désaccord important sur le champ "${key}" entre plusieurs sources.`,
      field: key,
      candidates: present.map((e) => ({ value: e.value, source: e.source, confidence: e.confidence })),
    });
    return { ...winner, confidence: Math.min(winner.confidence, MAJOR_CONTRADICTION_CONFIDENCE) };
  }

  return { ...winner, confidence: Math.max(0, winner.confidence - CONTRADICTION_PENALTY) };
}

/**
 * Fusionne plusieurs extractions candidates (déterministe, fournie, IA) en
 * un `ExtractedProduct` unique. `criticalAttributeKeys` désigne les clés
 * d'`attributes` requises pour l'identification de la catégorie courante
 * (voir `parser/requirement-profiles.ts`) : une contradiction sur l'une
 * d'elles produit un `MAJOR_CONTRADICTION` plutôt qu'une simple pénalité —
 * le signal remonte à Intelligence Core via l'absence de champ fiable,
 * jamais une décision prise ici.
 */
export function mergeExtractions(
  candidates: SourcedExtraction[],
  criticalAttributeKeys: string[] = [],
): { product: ExtractedProduct; warnings: ExtractionWarning[] } {
  const warnings: ExtractionWarning[] = [];
  const merged: Record<string, FieldEntry> = {};

  for (const key of TOP_LEVEL_FIELDS) {
    const entries = candidates.map((c) => (c.product as unknown as Record<string, FieldEntry>)[key] ?? null);
    merged[key] = mergeField(entries, key, false, warnings);
  }

  const attributeKeys = new Set<string>();
  for (const candidate of candidates) {
    for (const key of Object.keys(candidate.product.attributes)) attributeKeys.add(key);
  }
  const mergedAttributes: Record<string, FieldEntry> = {};
  for (const key of attributeKeys) {
    const entries = candidates.map((c) => c.product.attributes[key] ?? null);
    mergedAttributes[key] = mergeField(entries, key, criticalAttributeKeys.includes(key), warnings);
  }

  const serialEntries = candidates.map((c) => c.product.serialNumberDetected).filter((e) => e !== undefined && e !== null);
  const anyDetected = serialEntries.some((e) => e.value === true);
  const serialConfidence = serialEntries.length > 0 ? Math.max(...serialEntries.map((e) => e.confidence)) : 0.5;
  const serialSource = serialEntries.find((e) => e.value === anyDetected)?.source ?? "deterministic";

  const product = extractedProductSchema.parse({
    ...merged,
    serialNumberDetected: { value: anyDetected, confidence: serialConfidence, source: serialSource },
    attributes: mergedAttributes,
  });

  return { product, warnings };
}
