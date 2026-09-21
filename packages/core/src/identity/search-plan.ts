import type { CanonicalProductIdentity, IdentityField } from "./canonical-product-identity";
import type { CostClass } from "../scheduling/snapshot-scheduling-policy";

/**
 * Planificateur de requête PAR IDENTIFIANT D'ABORD (LOT "Historical Data
 * Engine", section 4) — remplace la génération de requête ad hoc déjà
 * pratiquée par chaque connecteur (Keepa/BrickLink/PriceCharting exigeaient
 * déjà des hints exacts, jamais de texte libre — voir Source Wave 2/3) par
 * un planificateur DÉCLARATIF et PARTAGÉ : un `QueryPlannerSourceProfile`
 * par source décrit CE QU'elle accepte, ce module décide QUOI lui envoyer
 * à partir d'une `CanonicalProductIdentity`, jamais l'inverse.
 *
 * Priorité stricte (instruction explicite du lot) :
 * 1. identifiant natif de la source (ex. ASIN Keepa, numéro BrickLink)
 * 2. identifiant universel (GTIN/EAN/UPC/MPN/référence/style code)
 * 3. marque + modèle + variante EXACTS
 * 4. requête de repli CONTRAINTE (marque OU modèle seul)
 *
 * Jamais un identifiant inventé, jamais une requête "poubelle" (aucune
 * information exploitable) — `buildSearchPlan` retourne `null` plutôt que
 * de générer un plan sans aucune substance.
 */

export type SearchExactness = "source_native_id" | "structural_identifier" | "exact_attributes" | "constrained_fallback";

export interface SearchPlanStep {
  source: string;
  q: string;
  hints: Record<string, unknown>;
  exactness: SearchExactness;
  /** Champs d'identité RÉELLEMENT utilisés pour construire ce plan — jamais une liste vide pour un plan non-null. */
  identifiersUsed: IdentityField[];
  /** 0 = meilleur niveau atteint pour cette source, croissant à chaque niveau de repli descendu. */
  fallbackStage: number;
  expectedEvidenceCapabilities: readonly string[];
  maxAttempts: number;
  costClass: CostClass;
}

export interface QueryPlannerSourceProfile {
  source: string;
  costClass: CostClass;
  expectedEvidenceCapabilities: readonly string[];
  /** Identifiants acceptés comme HINT DÉDIÉ et exact par cette source, dans l'ordre de préférence — jamais une supposition sur ce qu'un connecteur accepte, doit refléter son contrat réel (`search()`). */
  exactHintFields: readonly { field: IdentityField; hintKey: string; isSourceNative: boolean }[];
  /** Identifiants universels que cette source n'accepte pas comme hint dédié mais qui valent la peine d'être envoyés comme TEXTE de requête exact (moteurs de recherche généralistes type Google Shopping) — dans l'ordre de préférence. */
  identifierQueryTextFields?: readonly IdentityField[];
  /** `true` si cette source accepte une requête en texte libre marque+modèle(+variante) en dernier recours. */
  supportsAttributeTextQuery: boolean;
}

function attributeQuery(identity: CanonicalProductIdentity, fields: readonly IdentityField[]): string | null {
  const parts = fields.map((f) => identity.fields[f]?.value).filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Construit le plan de requête pour UNE source à partir d'une identité
 * canonique — `null` si aucun niveau de la hiérarchie n'est atteignable
 * (jamais une requête sans substance). Ne modifie ni ne complète jamais
 * `identity` — fonction pure, lecture seule.
 */
export function buildSearchPlan(identity: CanonicalProductIdentity, profile: QueryPlannerSourceProfile): SearchPlanStep | null {
  let fallbackStage = 0;

  for (const { field, hintKey, isSourceNative } of profile.exactHintFields) {
    const claim = identity.fields[field];
    if (claim) {
      return {
        source: profile.source,
        q: claim.value,
        hints: { [hintKey]: claim.value },
        exactness: isSourceNative ? "source_native_id" : "structural_identifier",
        identifiersUsed: [field],
        fallbackStage,
        expectedEvidenceCapabilities: profile.expectedEvidenceCapabilities,
        maxAttempts: 1,
        costClass: profile.costClass,
      };
    }
    fallbackStage += 1;
  }

  for (const field of profile.identifierQueryTextFields ?? []) {
    const claim = identity.fields[field];
    if (claim) {
      return {
        source: profile.source,
        q: claim.value,
        hints: {},
        exactness: "structural_identifier",
        identifiersUsed: [field],
        fallbackStage,
        expectedEvidenceCapabilities: profile.expectedEvidenceCapabilities,
        maxAttempts: 1,
        costClass: profile.costClass,
      };
    }
    fallbackStage += 1;
  }

  if (!profile.supportsAttributeTextQuery) return null;

  const exactAttributesQuery = attributeQuery(identity, ["brand", "model", "variant"]);
  if (identity.fields.brand && identity.fields.model && exactAttributesQuery) {
    return {
      source: profile.source,
      q: exactAttributesQuery,
      hints: {},
      exactness: "exact_attributes",
      identifiersUsed: (["brand", "model", "variant"] as IdentityField[]).filter((f) => identity.fields[f]),
      fallbackStage,
      expectedEvidenceCapabilities: profile.expectedEvidenceCapabilities,
      maxAttempts: 2,
      costClass: profile.costClass,
    };
  }
  fallbackStage += 1;

  const constrainedQuery = attributeQuery(identity, ["brand", "model"]);
  if (constrainedQuery) {
    return {
      source: profile.source,
      q: constrainedQuery,
      hints: {},
      exactness: "constrained_fallback",
      identifiersUsed: (["brand", "model"] as IdentityField[]).filter((f) => identity.fields[f]),
      fallbackStage,
      expectedEvidenceCapabilities: profile.expectedEvidenceCapabilities,
      maxAttempts: 1,
      costClass: profile.costClass,
    };
  }

  // Ni identifiant, ni marque, ni modèle -> aucune requête exploitable pour cette source, jamais une requête "poubelle".
  return null;
}

/** Construit un plan par source pour TOUTES les sources d'un registre — les sources sans plan atteignable sont simplement absentes du résultat, jamais un plan vide inséré à leur place. */
export function buildSearchPlans(identity: CanonicalProductIdentity, profiles: readonly QueryPlannerSourceProfile[]): SearchPlanStep[] {
  return profiles.flatMap((profile) => {
    const plan = buildSearchPlan(identity, profile);
    return plan ? [plan] : [];
  });
}

/**
 * Profils DÉCLARATIFS pour les sources RÉELLEMENT construites à ce jour
 * (LOT "Source Wave 1/2/3") — reflètent honnêtement le contrat `search()`
 * de chaque connecteur, jamais une supposition. Un futur connecteur
 * ajoute une entrée ici, jamais une réécriture du planificateur lui-même.
 */
export const KNOWN_SOURCE_QUERY_PROFILES: readonly QueryPlannerSourceProfile[] = [
  {
    source: "keepa",
    costClass: "paid",
    expectedEvidenceCapabilities: ["retailPrices", "historicalPrices", "barcodeLookup"],
    exactHintFields: [
      { field: "asin", hintKey: "asin", isSourceNative: true },
      { field: "upc", hintKey: "upc", isSourceNative: false },
      { field: "ean", hintKey: "ean", isSourceNative: false },
    ],
    supportsAttributeTextQuery: false,
  },
  {
    source: "bricklink",
    costClass: "free",
    expectedEvidenceCapabilities: ["historicalPrices", "activeListings"],
    exactHintFields: [{ field: "bricklinkNo", hintKey: "bricklinkNo", isSourceNative: true }],
    supportsAttributeTextQuery: false,
  },
  {
    source: "pricecharting",
    costClass: "cheap",
    expectedEvidenceCapabilities: ["historicalPrices"],
    exactHintFields: [
      { field: "priceChartingId", hintKey: "priceChartingId", isSourceNative: true },
      { field: "upc", hintKey: "upc", isSourceNative: false },
    ],
    supportsAttributeTextQuery: false,
  },
  {
    source: "ebay",
    costClass: "free",
    expectedEvidenceCapabilities: ["activeListings"],
    exactHintFields: [],
    identifierQueryTextFields: ["gtin", "ean", "upc", "mpn"],
    supportsAttributeTextQuery: true,
  },
  {
    source: "google_shopping",
    costClass: "paid",
    expectedEvidenceCapabilities: ["retailPrices", "activeListings"],
    exactHintFields: [],
    identifierQueryTextFields: ["gtin", "ean", "upc", "mpn"],
    supportsAttributeTextQuery: true,
  },
  {
    source: "dataforseo_google_shopping",
    costClass: "paid",
    expectedEvidenceCapabilities: ["retailPrices"],
    exactHintFields: [],
    identifierQueryTextFields: ["gtin", "ean", "upc", "mpn"],
    supportsAttributeTextQuery: true,
  },
];
