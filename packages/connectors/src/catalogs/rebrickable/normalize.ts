import type { CatalogItem, CatalogMatch } from "../../types";
import type { RebrickableSet } from "./raw-types";

/**
 * `RebrickableSet` → `CatalogItem` — ENRICHISSEMENT D'IDENTITÉ CATALOGUE
 * LEGO UNIQUEMENT (LOT "Free/Open Sources + Real Readiness + Live Smoke
 * Tests", section 4) : AUCUN prix, jamais présenté comme un remplacement
 * de BrickLink (source de PRIX déjà en place, `packages/connectors/src/
 * bricklink/`) — `priceHints` n'est jamais peuplé ici.
 */
export function normalizeRebrickableSet(raw: RebrickableSet): CatalogItem {
  return {
    source: "rebrickable",
    externalId: raw.set_num,
    kind: "lego_set",
    categorySlug: "lego",
    name: raw.name ?? raw.set_num,
    canonicalAttributes: {
      setNumber: raw.set_num,
      year: raw.year ?? null,
      themeId: raw.theme_id ?? null,
      numParts: raw.num_parts ?? null,
      lastModifiedAt: raw.last_modified_dt ?? null,
    },
    images: raw.set_img_url ? [raw.set_img_url] : [],
    externalUrl: raw.set_url ?? null,
    raw,
  };
}

/**
 * Correspondance EXACTE par numéro de set uniquement (jamais une recherche
 * par nom flou — Rebrickable propose un endpoint de recherche par nom
 * séparé, non consommé par ce connecteur ce lot, conformément à la
 * discipline "exact set number first" du brief).
 */
export function matchRebrickableSet(raw: RebrickableSet): CatalogMatch {
  return { item: normalizeRebrickableSet(raw), confidence: 1, matchedOn: ["setNumber"] };
}
