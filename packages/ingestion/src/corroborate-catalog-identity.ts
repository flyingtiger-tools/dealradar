import { setNamesMatch, type CatalogMatch } from "@dealradar/connectors";

/**
 * `single_catalog_source` est distinct de `single_source` : ce dernier
 * signifie que le catalogue secondaire a répondu mais n'a rien trouvé
 * (`corroborateCatalogIdentity`, ci-dessous). `single_catalog_source`
 * signifie que le catalogue principal (Pokémon TCG API) n'a pas pu être
 * interrogé du tout (panne réseau/5xx après retries) — jamais produit par
 * cette fonction, seulement construit par l'orchestration
 * (`buildSingleCatalogSourceFallback`) quand cette panne est constatée.
 */
export type CatalogCorroborationOutcome = "corroborated" | "single_source" | "single_catalog_source" | "diverged";

export interface CatalogCorroborationResult {
  outcome: CatalogCorroborationOutcome;
  /** Identité retenue pour la suite du pipeline — toujours la source principale (Pokémon TCG API), sauf `single_catalog_source`. */
  primary: CatalogMatch;
  warnings: string[];
}

/**
 * Confiance plafonnée quand seul un catalogue secondaire a pu répondre
 * (panne du catalogue principal) — jamais une confiance totale, même si ce
 * catalogue seul avait matché parfaitement : la corroboration normalement
 * requise n'a pas pu avoir lieu, donc `exact_match` ne doit jamais en
 * découler plus loin (voir `classifyCrossMatch`, LOT 3, qui exige
 * `identity.confidence === 1`).
 */
export const SINGLE_CATALOG_SOURCE_MAX_CONFIDENCE = 0.5;

/**
 * Construit un résultat de corroboration "dégradé" quand le catalogue
 * principal (Pokémon TCG API) n'a pas pu être interrogé — jamais une
 * correspondance inventée : `fallbackMatch` doit être un vrai résultat du
 * catalogue secondaire (TCGdex). La confiance de ce match est plafonnée,
 * jamais utilisée telle quelle.
 */
export function buildSingleCatalogSourceFallback(fallbackMatch: CatalogMatch, unavailabilityReason: string): CatalogCorroborationResult {
  return {
    outcome: "single_catalog_source",
    primary: { ...fallbackMatch, confidence: Math.min(fallbackMatch.confidence, SINGLE_CATALOG_SOURCE_MAX_CONFIDENCE) },
    warnings: [
      `Catalogue principal (Pokémon TCG API) indisponible : ${unavailabilityReason} — identité résolue uniquement par ${fallbackMatch.item.source}, jamais corroborée, confiance plafonnée à ${SINGLE_CATALOG_SOURCE_MAX_CONFIDENCE}.`,
    ],
  };
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
  // Jamais une égalité brute : "Base" (Pokémon TCG API) et "Base Set"
  // (TCGdex) désignent le même set réel — démontré par test réel, LOT 7B.
  // Voir `set-name-matching.ts` pour les règles exactes (normalisation,
  // retrait de suffixe contrôlé, alias explicite — jamais de fuzzy matching).
  const setMatches = primarySet !== null && secondarySet !== null && setNamesMatch(primarySet, secondarySet).matched;
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
