/**
 * Priorité de routage des sources d'IDENTITÉ/CATALOGUE gratuites/ouvertes
 * (LOT "Free/Open Sources + Real Readiness + Live Smoke Tests", section
 * 11) — encode l'ordre dans lequel les nouveaux Catalog Connectors
 * (`@dealradar/connectors`, section 2-7 de ce lot) DEVRAIENT être
 * consultés avant un fallback de recherche large payant (Google Shopping/
 * SerpApi, DataForSEO), en fonction des indices EXACTS déjà connus pour un
 * produit.
 *
 * **Portée délibérément limitée à ce lot** : ce module reste une fonction
 * PURE de sélection d'ordre, jamais elle-même branchée dans
 * `process-analysis.ts`/`take-product-snapshot.ts` — aucune étape
 * d'enrichissement catalogue n'existe aujourd'hui dans le chemin
 * générique interactif (seule la verticale TCG consomme un Catalog
 * Connector, voir `orchestrate-pokemon-pipeline.ts`). Câbler ces sources
 * dans le chemin générique serait une intégration architecturale
 * SÉPARÉE et substantielle (signature de `buildSourceSelectionPlan`,
 * persistance d'une identité enrichie, tests d'intégration bout en bout) —
 * hors scope raisonnable de ce lot déjà large ; documentée ici comme
 * PRÊTE, jamais faussement présentée comme déjà active.
 *
 * Règle absolue (section 11 du brief) : une source CATALOGUE-SEULEMENT
 * (jamais de prix) ne doit JAMAIS gonfler artificiellement la diversité de
 * source dans la fusion de valeur de marché — ce module ne retourne que
 * des noms de source d'IDENTITÉ, jamais mélangés avec le calcul de
 * `sourceCount`/`marketEvidence` fait ailleurs (`fuseMarketObservations`,
 * `@dealradar/core`).
 */

export interface IdentityHints {
  /** GTIN/EAN/UPC exact, si connu (scan code-barres, extraction IA, etc.). */
  barcode?: string | null;
  /** Numéro de set LEGO exact (avec ou sans suffixe `-1`). */
  legoSetNumber?: string | null;
  /** `true` si la capture a déjà été routée vers la verticale TCG (voir `ScannerEntryScreen.tsx`) — TCGdex reste géré par son propre pipeline, jamais dupliqué ici. */
  isTcgCard?: boolean;
  /** Titre de jeu vidéo exact, si connu. */
  gamingTitle?: string | null;
}

export interface IdentitySourceRoutingEntry {
  source: "open_food_facts" | "open_products_facts" | "rebrickable" | "tcgdex" | "igdb" | "wikidata";
  /** Slug de catégorie DealRadar le plus directement concerné — indicatif, jamais une restriction stricte imposée par ce module. */
  categorySlug: string;
  reason: string;
}

/**
 * Ordre de priorité PAR INDICE DISPONIBLE — jamais une liste unique fixe :
 * chaque indice EXACT connu ajoute les sources qui savent l'exploiter,
 * dans l'ordre où elles devraient être consultées AVANT tout fallback de
 * recherche large payant. Wikidata reste toujours en DERNIER quand un
 * indice plus spécifique existe (couverture GTIN clairsemée, audit
 * confirmé section 5) — jamais la première source essayée si une
 * alternative plus fiable est disponible pour le même indice.
 */
export function routeIdentitySources(hints: IdentityHints): IdentitySourceRoutingEntry[] {
  const entries: IdentitySourceRoutingEntry[] = [];

  if (hints.isTcgCard) {
    // La verticale TCG a déjà son propre pipeline (`orchestrate-pokemon-
    // pipeline.ts`, TCGdex + Pokémon TCG API) — ce module ne fait
    // qu'EXPOSER ce fait pour un appelant générique qui voudrait éviter de
    // dupliquer l'identification, jamais une invocation ici.
    entries.push({ source: "tcgdex", categorySlug: "pokemon_tcg", reason: "carte TCG déjà routée vers son propre pipeline — TCGdex y est déjà consulté, jamais dupliqué ici" });
    return entries;
  }

  if (hints.barcode) {
    // Open Food Facts avant Open Products Facts : couverture RÉELLE
    // nettement plus large (audit confirmé section 3), jamais l'inverse.
    entries.push({ source: "open_food_facts", categorySlug: "general", reason: "code-barres exact — couverture la plus large des deux backends Product Opener" });
    entries.push({ source: "open_products_facts", categorySlug: "general", reason: "code-barres exact — repli si Open Food Facts n'a pas ce produit (couverture non-alimentaire plus large mais plus clairsemée)" });
  }

  if (hints.legoSetNumber) {
    entries.push({ source: "rebrickable", categorySlug: "lego", reason: "numéro de set LEGO exact — identité uniquement, jamais un prix (BrickLink reste la source de prix)" });
  }

  if (hints.gamingTitle) {
    // IGDB reste listé ici pour DOCUMENTER l'ordre voulu si la source
    // devient un jour `productionAllowed: true` — jamais invoqué tant que
    // `SOURCE_READINESS_MATRIX` la verrouille (voir source-readiness-
    // matrix.ts, policyStatus: "license_required").
    entries.push({ source: "igdb", categorySlug: "gaming", reason: "titre de jeu exact — VERROUILLÉ commercialement à ce jour, voir source-readiness-matrix.ts" });
  }

  if (hints.barcode) {
    // Wikidata TOUJOURS en dernier quand un GTIN est connu : couverture
    // clairsemée (audit confirmé section 5), jamais essayé avant Open
    // Food/Products Facts pour le même indice.
    entries.push({ source: "wikidata", categorySlug: "general", reason: "code-barres exact — complément final à faible taux de succès, jamais une source primaire" });
  }

  return entries;
}
