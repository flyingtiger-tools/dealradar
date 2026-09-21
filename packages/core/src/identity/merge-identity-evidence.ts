import type { CanonicalProductIdentity, FieldClaim, IdentityField, IdentityFieldClaims, IdentityFieldConflict, HardConflictField } from "./canonical-product-identity";
import { isHardConflictField } from "./canonical-product-identity";

/**
 * Moteur de fusion d'évidence d'identité (LOT "Historical Data Engine",
 * section 2) — fonction PURE : combine une nouvelle preuve d'identité
 * (scan IA, code-barres, détails produit connecteur, attributs d'annonce,
 * lookup catalogue, alias déjà persisté) avec une identité déjà connue.
 * Ne réécrit JAMAIS une affirmation existante sur un CHAMP DUR (voir
 * `HARD_CONFLICT_FIELDS`) qui entre en désaccord — enregistre un conflit
 * explicite à la place. Un champ manquant peut toujours être enrichi.
 */
export interface IdentityEvidence {
  source: string;
  confidence: number;
  observedAt: string;
  fields: Partial<Record<IdentityField, string>>;
  /** Identifiants/alias hors champs structurés (ex. un id de listing interne à une source) — jamais perdus. */
  aliases?: { field: string; value: string }[];
}

export interface MergeIdentityResult {
  identity: CanonicalProductIdentity;
  /** Conflits NOUVELLEMENT détectés par CETTE fusion précise — sous-ensemble de `identity.conflicts`, jamais les conflits déjà connus avant cet appel. */
  newConflicts: IdentityFieldConflict[];
}

function claimsEqual(a: FieldClaim, b: FieldClaim): boolean {
  return normalizeForComparison(a.value) === normalizeForComparison(b.value);
}

/** Normalisation de comparaison SÛRE — casse et espaces uniquement, jamais une reformulation sémantique qui pourrait masquer un vrai désaccord. */
function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase();
}

function mergeField(
  field: IdentityField,
  existing: FieldClaim | null | undefined,
  incoming: FieldClaim,
): { claim: FieldClaim; conflict: IdentityFieldConflict | null } {
  if (!existing) return { claim: incoming, conflict: null };
  if (claimsEqual(existing, incoming)) return { claim: existing, conflict: null };

  if (isHardConflictField(field)) {
    // Jamais résolu silencieusement — l'affirmation existante reste en place, le conflit est explicite.
    return { claim: existing, conflict: { field, claims: [existing, incoming] } };
  }

  // Champ doux : la claim la plus digne de confiance l'emporte, jamais un blocage.
  return { claim: incoming.confidence > existing.confidence ? incoming : existing, conflict: null };
}

export function mergeIdentityEvidence(existing: CanonicalProductIdentity, evidence: IdentityEvidence): MergeIdentityResult {
  const fields: IdentityFieldClaims = { ...existing.fields };
  const newConflicts: IdentityFieldConflict[] = [];

  for (const [fieldName, value] of Object.entries(evidence.fields) as [IdentityField, string | undefined][]) {
    if (value === undefined || value.trim().length === 0) continue;

    const incomingClaim: FieldClaim = { value, source: evidence.source, confidence: evidence.confidence, observedAt: evidence.observedAt };
    const { claim, conflict } = mergeField(fieldName, existing.fields[fieldName], incomingClaim);
    fields[fieldName] = claim;
    if (conflict) newConflicts.push(conflict);
  }

  const aliases: (FieldClaim & { field: string })[] = [...existing.aliases];
  for (const alias of evidence.aliases ?? []) {
    const alreadyKnown = aliases.some(
      (a) => a.field === alias.field && a.source === evidence.source && normalizeForComparison(a.value) === normalizeForComparison(alias.value),
    );
    if (!alreadyKnown) aliases.push({ field: alias.field, value: alias.value, source: evidence.source, confidence: evidence.confidence, observedAt: evidence.observedAt });
  }

  return {
    identity: { ...existing, fields, aliases, conflicts: [...existing.conflicts, ...newConflicts] },
    newConflicts,
  };
}

/**
 * Résolution EXPLICITE d'un conflit (LOT, section 2 — "conflicts must be
 * representable, not silently overwritten" implique aussi une résolution
 * jamais implicite). Remplace la claim retenue et retire le conflit de la
 * liste — jamais automatique, toujours un choix délibéré de l'appelant
 * (ex. un opérateur humain, ou une règle produit future explicitement
 * documentée — aucune règle de ce type n'existe encore dans ce lot).
 */
export function resolveIdentityConflict(identity: CanonicalProductIdentity, field: HardConflictField, winningClaim: FieldClaim): CanonicalProductIdentity {
  return {
    ...identity,
    fields: { ...identity.fields, [field]: winningClaim },
    conflicts: identity.conflicts.filter((c) => c.field !== field),
  };
}
