import type { CatalogMatch } from "@dealradar/connectors";

export type CatalogCorroborationOutcome = "corroborated" | "single_source" | "diverged";

export interface CatalogCorroborationResult {
  outcome: CatalogCorroborationOutcome;
  /** Identité retenue pour la suite du pipeline — toujours la source principale (Pokémon TCG API). */
  primary: CatalogMatch;
  warnings: string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function stringAttr(match: CatalogMatch, key: string): string | null {
  const value = match.item.canonicalAttributes[key];
  return typeof value === "string" ? value : null;
}

/**
 * Corrobore l'identité résolue par deux Catalog Connectors (Pokémon TCG API
 * + TCGdex, LOT 7B) — set + numéro + nom uniquement, jamais un moteur de
 * correspondance générique. Une divergence sur ces champs refuse la
 * corroboration (identité non fiable) plutôt que de faire confiance à une
 * seule source silencieusement — voir LOT 7B, règle "une divergence...
 * entraîne un refus".
 */
export function corroborateCatalogIdentity(primary: CatalogMatch | null, secondary: CatalogMatch | null): CatalogCorroborationResult | null {
  if (!primary) return null;

  if (!secondary) {
    return {
      outcome: "single_source",
      primary,
      warnings: [`Identité résolue par une seule source catalogue (${primary.item.source}) — non corroborée par une seconde source.`],
    };
  }

  const nameMatches = normalize(primary.item.name) === normalize(secondary.item.name);
  const primarySet = stringAttr(primary, "setName");
  const secondarySet = stringAttr(secondary, "setName");
  const setMatches = primarySet !== null && secondarySet !== null && normalize(primarySet) === normalize(secondarySet);
  const primaryNumber = stringAttr(primary, "collectorNumber");
  const secondaryNumber = stringAttr(secondary, "collectorNumber");
  const numberMatches = primaryNumber !== null && secondaryNumber !== null && normalize(primaryNumber) === normalize(secondaryNumber);

  if (nameMatches && setMatches && numberMatches) {
    return {
      outcome: "corroborated",
      primary,
      warnings: [`Identité corroborée par ${primary.item.source} et ${secondary.item.source}.`],
    };
  }

  const mismatches = [!nameMatches ? "nom" : null, !setMatches ? "set" : null, !numberMatches ? "numéro" : null].filter(
    (v): v is string => v !== null,
  );
  return {
    outcome: "diverged",
    primary,
    warnings: [
      `Divergence entre ${primary.item.source} et ${secondary.item.source} sur ${mismatches.join(", ")} — identité non fiable, refusée.`,
    ],
  };
}
