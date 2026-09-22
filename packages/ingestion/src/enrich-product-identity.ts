import type { CanonicalProductIdentity, FieldClaim, IdentityField } from "@dealradar/core";
import { createCanonicalProductIdentity, mergeIdentityEvidence } from "@dealradar/core";
import type { CatalogItem, CatalogMatch } from "@dealradar/connectors";
import { routeIdentitySources, type IdentityHints } from "./identity-source-routing";

/**
 * Enrichissement d'identité produit RÉEL (LOT "Live Identity Enrichment +
 * Barcode-First + upc.dev Fallback + Railway Readiness", section 1/5) —
 * consulte les sources d'identité gratuites/ouvertes routées par
 * `identity-source-routing.ts`, dans l'ORDRE qu'elles indiquent, et
 * fusionne leurs affirmations EXACTES avec celles de l'extraction IA via
 * le moteur de fusion DÉJÀ EXISTANT et testé (`mergeIdentityEvidence`,
 * `@dealradar/core`) — jamais une réimplémentation parallèle de la
 * politique de conflit.
 *
 * **La clé de la politique de fusion (section 5 du brief) tient tout
 * entière dans l'ORDRE des deux appels à `mergeIdentityEvidence`
 * ci-dessous, jamais dans une logique de fusion nouvelle** :
 * `mergeIdentityEvidence` (préexistant) garde TOUJOURS la claim `existing`
 * pour un champ DUR en désaccord (`HARD_CONFLICT_FIELDS` — storage, gtin,
 * ean, upc, bricklinkNo…), en journalisant le conflit. En fusionnant
 * D'ABORD les affirmations catalogue (exactes) puis SEULEMENT ENSUITE
 * l'extraction IA, un désaccord dur voit la valeur CATALOGUE l'emporter
 * (elle est `existing` au moment où l'IA arrive), exactement l'exemple du
 * brief : "AI says 128GB but exact GTIN says 256GB → exact GTIN wins and
 * conflict is logged". Un champ que le catalogue n'a jamais renseigné
 * reste librement enrichi par l'IA (rien à qui s'opposer).
 *
 * Une correspondance AMBIGUË (zéro OU plusieurs résultats à confiance
 * maximale pour le même indice exact) est REJETÉE entièrement, jamais
 * une supposition sur laquelle des candidats retenir (section 5 :
 * "unrelated Wikidata entity with ambiguous identifier → reject").
 */

/** Injecté par l'appelant réel (voir `catalog-source-factory.ts`, `apps/workers`) — jamais un appel réseau direct depuis ce module pur, testable avec un faux lookup. */
export type CatalogLookupFn = (source: string, hints: IdentityHints, categorySlug: string) => Promise<CatalogMatch[]>;

export interface EnrichProductIdentityInput {
  categorySlug: string;
  hints: IdentityHints;
  /** Champs déjà extraits par l'IA — jamais recalculés ici, seulement fusionnés. */
  aiFields: Partial<Record<IdentityField, string>>;
  asOf: string;
  lookup: CatalogLookupFn;
}

/**
 * Explique HONNÊTEMENT comment l'identité a été établie (section 12,
 * user-facing) — `visual_only` reste le défaut tant qu'AUCUNE source
 * catalogue exacte n'a confirmé quoi que ce soit, jamais un libellé
 * optimiste non mérité.
 */
export type IdentityQualityMethod = "barcode_confirmed" | "lego_catalog_confirmed" | "visual_only";

export interface EnrichProductIdentityResult {
  identity: CanonicalProductIdentity;
  /** Vue plate `champ -> valeur` de `identity.fields`, prête pour `deriveProductKey` — jamais une seconde dérivation divergente. */
  mergedFields: Partial<Record<IdentityField, string>>;
  sourcesConsulted: string[];
  /** Jamais interrogées car un indice du MÊME groupe (ex. code-barres) était déjà résolu avec confiance — "no duplicate network lookups" (section 1). */
  sourcesSkipped: string[];
  qualityMethod: IdentityQualityMethod;
  hadConflict: boolean;
}

const EXACT_CATALOG_CONFIDENCE = 0.95;
const AI_EXTRACTION_CONFIDENCE = 0.6;

/** `"128GB"`/`"256 GB"`/`"1TB"` -> `"128GB"`/`"256GB"`/`"1TB"` — jamais une capacité devinée au-delà d'un motif chiffre+unité explicite dans le texte. */
function extractCapacityFromText(text: string): string | null {
  const match = text.match(/(\d+)\s*(GB|TB)\b/i);
  return match ? `${match[1]}${match[2]!.toUpperCase()}` : null;
}

/**
 * Traduction PAR SOURCE d'un `CatalogItem` en affirmations d'identité —
 * volontairement CONSERVATRICE : `open_food_facts`/`open_products_facts`
 * n'extraient JAMAIS de marque (leur champ `brands` mélange souvent marque
 * et gamme de produit, ex. "Nutella, Ferrero" — pas assez fiable pour
 * un champ dur/doux structuré) ni de modèle (leur `product_name` est
 * fréquemment un texte générique/incomplet, "Open Facts low-quality
 * generic title must not overwrite stronger brand/model claims", section
 * 5) — seule la capacité (motif GB/TB EXPLICITE et objectif) et le GTIN
 * lui-même en sont tirés. Wikidata, plus structuré (propriété fabricant
 * dédiée `wdt:P176`), fournit aussi la marque. Rebrickable fournit le
 * numéro de set (`bricklinkNo` — même champ dur que le catalogue
 * BrickLink, puisque Rebrickable et BrickLink partagent la même
 * numérotation officielle LEGO, suffixe `-1` retiré) et le nom du set.
 */
export function deriveIdentityFieldsFromCatalogItem(item: CatalogItem, queriedBarcode: string | null): Partial<Record<IdentityField, string>> {
  const fields: Partial<Record<IdentityField, string>> = {};

  if (item.source === "open_food_facts" || item.source === "open_products_facts" || item.source === "upcdev") {
    // upc.dev reçoit EXACTEMENT le même traitement conservateur qu'Open
    // Food/Products Facts (LOT "Live Identity Enrichment...", section 3) —
    // son `name` est un texte libre agrégé de "dizaines de sources" de
    // qualité par-enregistrement non vérifiée (confirmé en direct : au
    // moins un produit testé y est lui-même backé par Open Food Facts,
    // voir `docs/free-open-sources-audit.md`), jamais assez fiable pour en
    // extraire une marque/un modèle structuré.
    if (queriedBarcode) fields.gtin = queriedBarcode;
    const capacity = extractCapacityFromText(item.name);
    if (capacity) fields.storage = capacity;
  } else if (item.source === "wikidata") {
    if (queriedBarcode) fields.gtin = queriedBarcode;
    const manufacturer = item.canonicalAttributes.manufacturer;
    if (typeof manufacturer === "string" && manufacturer.trim().length > 0) fields.brand = manufacturer;
    const capacity = extractCapacityFromText(item.name);
    if (capacity) fields.storage = capacity;
  } else if (item.source === "rebrickable") {
    const setNumber = item.canonicalAttributes.setNumber;
    if (typeof setNumber === "string" && setNumber.trim().length > 0) fields.bricklinkNo = setNumber.replace(/-\d+$/, "");
    if (item.name && item.name !== item.externalId) fields.model = item.name;
  }

  return fields;
}

const BARCODE_GROUP = new Set(["open_food_facts", "open_products_facts", "wikidata", "upcdev"]);

export async function enrichProductIdentity(input: EnrichProductIdentityInput): Promise<EnrichProductIdentityResult> {
  const routing = routeIdentitySources(input.hints);
  const sourcesConsulted: string[] = [];
  const sourcesSkipped: string[] = [];
  let identity = createCanonicalProductIdentity(input.categorySlug);
  let qualityMethod: IdentityQualityMethod = "visual_only";
  let barcodeGroupResolved = false;
  let legoResolved = false;

  for (const entry of routing) {
    // La verticale TCG a son propre pipeline dédié (`orchestrate-pokemon-
    // pipeline.ts`) — un appelant qui atteint CE module l'a déjà, par
    // construction, exclue (voir `process-analysis.ts` : la branche
    // `pokemon_tcg` retourne avant même d'atteindre l'enrichissement
    // générique). Filet de sécurité défensif ici, jamais un appel réel :
    // TCGdex n'est JAMAIS interrogé via ce module, même si `routing`
    // l'inclut pour un appelant qui fournirait `isTcgCard` par erreur.
    if (entry.source === "tcgdex") {
      sourcesSkipped.push(entry.source);
      continue;
    }
    if (BARCODE_GROUP.has(entry.source) && barcodeGroupResolved) {
      sourcesSkipped.push(entry.source);
      continue;
    }
    if (entry.source === "rebrickable" && legoResolved) {
      sourcesSkipped.push(entry.source);
      continue;
    }

    let matches: CatalogMatch[];
    try {
      matches = await input.lookup(entry.source, input.hints, entry.categorySlug);
    } catch {
      // Panne d'UNE source catalogue ISOLÉE — jamais bloquante pour
      // l'analyse utilisateur (même discipline que tout le reste du
      // pipeline). "Consultée" reste honnête : une tentative a bien eu
      // lieu, même en échec.
      sourcesConsulted.push(entry.source);
      continue;
    }
    sourcesConsulted.push(entry.source);

    // Ambiguïté (0 ou PLUSIEURS résultats à confiance maximale) : REJETÉE
    // entièrement, jamais une supposition sur le bon candidat (section 5).
    const best = matches.length === 1 ? matches[0]! : null;
    if (!best || best.confidence < 1) continue;

    const fields = deriveIdentityFieldsFromCatalogItem(best.item, input.hints.barcode ?? null);
    if (Object.keys(fields).length === 0) continue;

    const { identity: merged } = mergeIdentityEvidence(identity, { source: entry.source, confidence: EXACT_CATALOG_CONFIDENCE, observedAt: input.asOf, fields });
    identity = merged;

    if (BARCODE_GROUP.has(entry.source)) {
      barcodeGroupResolved = true;
      qualityMethod = "barcode_confirmed";
    }
    if (entry.source === "rebrickable") {
      legoResolved = true;
      qualityMethod = "lego_catalog_confirmed";
    }
  }

  // Extraction IA fusionnée EN DERNIER — voir l'en-tête du fichier pour la
  // raison exacte de cet ordre.
  const { identity: withAi, newConflicts } = mergeIdentityEvidence(identity, {
    source: "ai_identification",
    confidence: AI_EXTRACTION_CONFIDENCE,
    observedAt: input.asOf,
    fields: input.aiFields,
  });
  identity = withAi;

  const mergedFields: Partial<Record<IdentityField, string>> = {};
  for (const [field, claim] of Object.entries(identity.fields) as [IdentityField, FieldClaim | null | undefined][]) {
    if (claim) mergedFields[field] = claim.value;
  }

  return {
    identity,
    mergedFields,
    sourcesConsulted,
    sourcesSkipped,
    qualityMethod,
    hadConflict: newConflicts.length > 0 || identity.conflicts.length > 0,
  };
}
