/**
 * Normalisation de condition INTER-CATÉGORIE (LOT "Data Quality
 * Calibration + Operator Observability + Mobile Market Insight Contract",
 * section 5) — fonction PURE, aucune I/O. Chaque source déclare son état
 * dans SON propre vocabulaire brut (voir `MarketObservation.condition`,
 * `@dealradar/connectors` : "jamais reformulé ici" — cette normalisation
 * est précisément le point unique où la reformulation a lieu, en aval,
 * jamais dans un connecteur lui-même).
 *
 * Pourquoi ce module existe : `isCompatibleWithTarget`
 * (`fuse-market-observations.ts`) exclut une observation UNIQUEMENT quand
 * `target.condition !== observation.condition` par ÉGALITÉ DE CHAÎNE
 * STRICTE. Sans normalisation partagée, "new" (eBay) et "brand new"
 * (Google Shopping) — sémantiquement identiques — seraient traités comme
 * CONFLICTUELS et s'excluraient mutuellement à tort. Ce module garantit
 * que TOUTE source qui affirme la même condition réelle produit la MÊME
 * valeur canonique avant comparaison.
 *
 * Règle absolue : jamais de condition DEVINÉE depuis l'absence de source
 * (une observation sans texte de condition renvoie `"unknown"`, jamais un
 * bucket positif fabriqué). Jamais de fusion silencieuse entre
 * neuf/scellé et occasion — un mapping ambigu ("used" seul, sans détail)
 * tombe sur un bucket MILIEU documenté (`"good"`), jamais sur
 * `"new_sealed"` ni `"poor_for_parts"`.
 */

export type CanonicalCondition = "new_sealed" | "like_new" | "very_good" | "good" | "fair" | "poor_for_parts" | "unknown";

export const CANONICAL_CONDITION_ORDER: readonly CanonicalCondition[] = ["new_sealed", "like_new", "very_good", "good", "fair", "poor_for_parts", "unknown"];

export interface ConditionNormalizationInput {
  /** Texte brut de la source, tel quel — jamais reformulé en amont. */
  rawCondition: string | null | undefined;
  /** Complétude déclarée si connue (ex. "sealed", "complete_in_box", "loose") — priorise `"sealed"` vers `new_sealed` même si `rawCondition` est vague, voir l'en-tête du fichier. */
  completeness?: string | null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

/**
 * Motifs de correspondance PAR BUCKET, dans l'ordre de PRIORITÉ
 * décroissante (le premier bucket dont un motif correspond gagne) —
 * jamais un ordre arbitraire : "for parts"/"broken" doivent primer sur un
 * simple "used" ambigu, "sealed" doit primer sur un "new" générique
 * seulement parce qu'il est plus SPÉCIFIQUE, pas parce qu'il est "meilleur".
 */
const BUCKET_PATTERNS: readonly { bucket: CanonicalCondition; patterns: RegExp[] }[] = [
  {
    bucket: "poor_for_parts",
    patterns: [/for_parts/, /for_parts_or_not_working/, /not_working/, /\bbroken\b/, /\bdamaged\b/, /\bpoor\b/, /\bparts_only\b/, /\bincomplete\b/, /\bacceptable\b/],
  },
  {
    bucket: "new_sealed",
    patterns: [/\bsealed\b/, /factory_sealed/, /\bnisb\b/, /brand_new/, /\bnew\b/, /new_other/, /new_with_tags/, /new_without_tags/, /\bunworn\b/, /\bdeadstock\b/, /\bmint\b/, /\bnib\b/],
  },
  { bucket: "like_new", patterns: [/like_new/, /open_box/, /\bexcellent\b/, /near_mint/] },
  { bucket: "very_good", patterns: [/very_good/] },
  { bucket: "fair", patterns: [/\bfair\b/] },
  { bucket: "good", patterns: [/\bgood\b/, /\brefurbished\b/, /\bused\b/] },
];

/**
 * Normalise UNE valeur de condition brute vers un bucket canonique — jamais
 * un bucket positif fabriqué en l'absence de texte exploitable (`"unknown"`
 * dans ce cas). `completeness === "sealed"` prime toujours sur un texte de
 * condition vague/absent (une annonce PriceCharting "new" avec
 * `completeness: "sealed"` reste `new_sealed`, jamais rétrogradée).
 */
export function normalizeCondition(input: ConditionNormalizationInput): CanonicalCondition {
  if (input.completeness && normalizeToken(input.completeness) === "sealed") return "new_sealed";

  if (!input.rawCondition) return "unknown";
  const token = normalizeToken(input.rawCondition);
  if (token.length === 0) return "unknown";

  for (const { bucket, patterns } of BUCKET_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(token))) return bucket;
  }
  return "unknown";
}

/**
 * `true` UNIQUEMENT quand les deux buckets sont connus (jamais `"unknown"`
 * des deux côtés) ET diffèrent — même philosophie que `isCompatibleWithTarget`
 * (`fuse-market-observations.ts`) : une valeur ABSENTE d'un côté ne bloque
 * jamais, seule une divergence entre deux valeurs CONNUES exclut. Ne
 * fusionne JAMAIS `new_sealed` avec un bucket usagé, ni l'inverse.
 */
export function isConditionMismatch(targetBucket: CanonicalCondition | null, observedBucket: CanonicalCondition): boolean {
  if (targetBucket === null || targetBucket === "unknown" || observedBucket === "unknown") return false;
  return targetBucket !== observedBucket;
}
