import type { CanonicalProductIdentity, HardConflictField, IdentityField } from "./canonical-product-identity";
import { buildSearchPlans, type QueryPlannerSourceProfile } from "./search-plan";

/**
 * Diagnostic d'identité lisible par machine (LOT "Close the Refresh Loop",
 * section 7) — fonction PURE, résume l'état de `CanonicalProductIdentity`
 * pour qu'un appelant (le futur moteur de rafraîchissement) puisse décider
 * en toute sécurité QUOI interroger sans jamais s'appuyer sur un champ en
 * conflit ni auto-résoudre quoi que ce soit — l'auto-résolution d'un
 * conflit dur reste interdite (voir `merge-identity-evidence.ts`).
 */
export interface IdentityHealthSummary {
  unresolvedConflictCount: number;
  conflictFields: HardConflictField[];
  /** Fraction (0–1) des identifiants structurels (durs) CONNUS parmi tous les champs durs possibles — jamais un pourcentage de "complétude produit" plus large, juste les identifiants. */
  identifierCoverage: number;
  /** Sources dont le plan de requête atteint le niveau `source_native_id`/`structural_identifier` — une requête EXACTE, jamais un texte libre. */
  exactSearchableSources: string[];
  /** Sources dont le SEUL plan atteignable est `exact_attributes`/`constrained_fallback` — un texte libre, jamais un identifiant. */
  fallbackOnlySources: string[];
  /** Sources pour lesquelles AUCUN plan n'est atteignable (identité trop faible pour cette source précise) — jamais interrogées pour ce cycle. */
  blockedSourcesDueToIdentity: string[];
}

const STRUCTURAL_IDENTIFIER_FIELDS: readonly IdentityField[] = ["mpn", "gtin", "ean", "upc", "asin", "bricklinkNo", "priceChartingId"];

/**
 * Retire du bag `fields` d'une identité tout champ IMPLIQUÉ dans un
 * conflit non résolu — utilisé pour construire des plans de requête qui
 * n'utilisent JAMAIS un identifiant contesté comme s'il était fiable
 * (instruction explicite du lot : "avoid exact-id queries based on a
 * conflicted identifier"). Ne modifie JAMAIS `identity.conflicts`
 * lui-même — l'identité originale, avec ses conflits intacts, reste la
 * source de vérité persistée ; cette fonction ne produit qu'une vue
 * dérivée sûre pour LA PLANIFICATION.
 */
export function stripConflictedFields(identity: CanonicalProductIdentity): CanonicalProductIdentity {
  if (identity.conflicts.length === 0) return identity;
  const conflictedFieldNames = new Set(identity.conflicts.map((c) => c.field));
  const safeFields = { ...identity.fields };
  for (const field of conflictedFieldNames) delete safeFields[field];
  return { ...identity, fields: safeFields };
}

export function summarizeIdentityHealth(identity: CanonicalProductIdentity, sourceProfiles: readonly QueryPlannerSourceProfile[]): IdentityHealthSummary {
  const conflictFields = [...new Set(identity.conflicts.map((c) => c.field))];

  const knownStructuralCount = STRUCTURAL_IDENTIFIER_FIELDS.filter((f) => identity.fields[f]).length;
  const identifierCoverage = knownStructuralCount / STRUCTURAL_IDENTIFIER_FIELDS.length;

  // Planification SUR LA VUE SÛRE (jamais sur un identifiant contesté) — voir `stripConflictedFields`.
  const safeIdentity = stripConflictedFields(identity);
  const safePlans = buildSearchPlans(safeIdentity, sourceProfiles);
  const safePlansBySource = new Map(safePlans.map((p) => [p.source, p] as const));

  const exactSearchableSources: string[] = [];
  const fallbackOnlySources: string[] = [];
  const blockedSourcesDueToIdentity: string[] = [];

  for (const profile of sourceProfiles) {
    const plan = safePlansBySource.get(profile.source);
    if (!plan) {
      blockedSourcesDueToIdentity.push(profile.source);
    } else if (plan.exactness === "source_native_id" || plan.exactness === "structural_identifier") {
      exactSearchableSources.push(profile.source);
    } else {
      fallbackOnlySources.push(profile.source);
    }
  }

  return {
    unresolvedConflictCount: identity.conflicts.length,
    conflictFields,
    identifierCoverage,
    exactSearchableSources,
    fallbackOnlySources,
    blockedSourcesDueToIdentity,
  };
}
