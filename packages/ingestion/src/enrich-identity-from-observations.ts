import type { MarketObservation } from "@dealradar/connectors";
import { ALL_IDENTITY_FIELDS, mergeIdentityEvidence, type CanonicalProductIdentity, type IdentityEvidence, type IdentityField, type IdentityFieldConflict } from "@dealradar/core";

const STRUCTURED_FIELD_SET = new Set<string>(ALL_IDENTITY_FIELDS);

/**
 * Boucle de rétroaction alias/id produit (LOT "Close the Refresh Loop",
 * section 8) — extrait UNIQUEMENT les identifiants déjà présents dans
 * `MarketObservation.identifiers` (un champ structuré rempli par le
 * connecteur lui-même à partir d'une donnée structurée de la source, ex.
 * l'ASIN de Keepa ou le numéro de set BrickLink) — ne parse JAMAIS un
 * titre de texte libre pour "deviner" un GTIN/MPN : si `identifiers` est
 * vide, aucune preuve d'identité n'est produite ici, jamais fabriquée.
 */
export function deriveIdentityEvidenceFromObservation(observation: MarketObservation): IdentityEvidence | null {
  const entries = Object.entries(observation.identifiers).filter(([, value]) => value && value.trim().length > 0);
  if (entries.length === 0) return null;

  const fields: Partial<Record<IdentityField, string>> = {};
  const aliases: { field: string; value: string }[] = [];
  for (const [key, value] of entries) {
    if (STRUCTURED_FIELD_SET.has(key)) fields[key as IdentityField] = value;
    else aliases.push({ field: key, value });
  }

  return {
    source: observation.source,
    // Confiance de l'affirmation d'IDENTITÉ (pas celle du prix) — un identifiant structuré fourni par un connecteur est déjà une donnée fiable de la source, jamais inférieure au matchScore de recherche qui mesure autre chose (la pertinence de CETTE annonce pour la requête).
    confidence: Math.max(0.7, observation.matchScore),
    observedAt: observation.observedAt,
    fields,
    aliases,
  };
}

export interface EnrichIdentityFromObservationsResult {
  identity: CanonicalProductIdentity;
  /** Nouveaux conflits détectés par CETTE passe d'enrichissement précise — jamais les conflits déjà connus avant l'appel. */
  newConflicts: IdentityFieldConflict[];
  /** Nombre d'observations ayant réellement fourni au moins un identifiant exploitable (structuré ou alias) — jamais le nombre total d'observations reçues. */
  observationsWithIdentifiers: number;
}

/**
 * Applique `deriveIdentityEvidenceFromObservation` à chaque observation
 * d'un cycle d'instantané et fusionne le résultat dans l'identité courante
 * via `mergeIdentityEvidence` (déjà pur et testé) — persiste UNIQUEMENT à
 * la charge de l'appelant (voir `persistCanonicalProductIdentity`, qui
 * persiste désormais aussi les claims conflictuelles, section 8).
 */
export function enrichIdentityFromObservations(
  identity: CanonicalProductIdentity,
  observations: readonly MarketObservation[],
): EnrichIdentityFromObservationsResult {
  let current = identity;
  const newConflicts: IdentityFieldConflict[] = [];
  let observationsWithIdentifiers = 0;

  for (const observation of observations) {
    const evidence = deriveIdentityEvidenceFromObservation(observation);
    if (!evidence) continue;
    observationsWithIdentifiers += 1;
    const merged = mergeIdentityEvidence(current, evidence);
    current = merged.identity;
    newConflicts.push(...merged.newConflicts);
  }

  return { identity: current, newConflicts, observationsWithIdentifiers };
}
