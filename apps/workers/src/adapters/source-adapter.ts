import type { RawListing } from "@dealradar/core";

/**
 * Contrat d'un adapter de source (ADR — isolation des scrapers).
 *
 * Règles :
 *  · un adapter ne touche JAMAIS la base : il produit des RawListing
 *  · un adapter déclare ses limites (cadence) : le scheduler les respecte
 *  · tout parsing fragile vit ici, confiné — une source qui casse
 *    n'affecte jamais le reste du pipeline
 *
 * Conformité : chaque adapter n'est activé qu'après revue des conditions
 * d'utilisation de la source et/ou accord (API partenaire quand elle existe).
 */
export interface SourceAdapter {
  readonly slug: string;
  /** Requêtes maximum par minute tolérées pour cette source. */
  readonly maxRequestsPerMinute: number;
  /** Retourne les annonces publiées/modifiées depuis `since`. */
  fetchListings(params: {
    since: Date;
    categoryPath?: string;
  }): AsyncIterable<RawListing>;
}
