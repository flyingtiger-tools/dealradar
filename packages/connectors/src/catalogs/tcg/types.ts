/**
 * Vocabulaire générique TCG — partagé par tous les futurs Catalog Connectors
 * TCG (Pokémon, One Piece, Magic, Lorcana, Yu-Gi-Oh!, Dragon Ball, Flesh and
 * Blood…). Rien ici n'est spécifique à Pokémon : un connecteur par jeu vit
 * dans son propre dossier (`catalogs/pokemon-tcg/`, futur `catalogs/one-piece/`…)
 * et traduit son API réelle vers ces types communs.
 */

/**
 * Ce qu'un produit TCG peut être, au-delà de la carte seule — couvre dès le
 * départ le scellé et le gradé, même si aucun catalogue actuel (Pokémon TCG
 * API) ne les résout tous. Un connecteur honnête déclare seulement les kinds
 * qu'il peut réellement identifier (voir `CatalogConnector.supportedKinds`).
 */
export type TcgProductKind =
  | "raw_card"
  | "graded_card"
  | "booster_pack"
  | "display_box"
  | "elite_trainer_box"
  | "tin"
  | "collection_box"
  | "bundle"
  | "sealed_product"
  | "lot";

/** Sociétés de grading reconnues — extensible sans casser les valeurs existantes. */
export type GradingCompany = "PSA" | "BGS" | "CGC" | "SGC" | "other";

/**
 * Indices déjà extraits (titre annonce, attributs IA, etc.) transmis à
 * `CatalogConnector.resolve()`. Tous optionnels : un connecteur ne doit
 * jamais supposer qu'un champ manquant vaut une valeur par défaut.
 */
export interface TcgCatalogHints {
  kind?: TcgProductKind;
  name?: string;
  setName?: string;
  setCode?: string;
  collectorNumber?: string;
  language?: string;
  gradingCompany?: GradingCompany;
  grade?: string;
  /** Sac extensible pour tout indice supplémentaire déjà extrait, sans forcer un schéma commun à tous les jeux. */
  extra?: Record<string, string>;
}
