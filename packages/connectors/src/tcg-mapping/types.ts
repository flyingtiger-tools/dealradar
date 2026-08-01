import type { NormalizedPriceObservation } from "../types";
import type { GradingCompany, TcgProductKind } from "../catalogs/tcg/types";

/**
 * Modèle canonique de correspondance TCG — commun à tout couple
 * Catalog Connector ↔ Pricing Connector (Pokémon ↔ JustTCG aujourd'hui,
 * n'importe quel autre TCG demain). Construit à partir d'un `CatalogMatch`
 * déjà résolu, jamais inventé : chaque champ vient soit du catalogue, soit
 * des indices d'origine transmis à l'appelant (variant/langue, que le
 * catalogue Pokémon ne porte pas lui-même).
 */
export interface TcgCanonicalIdentity {
  game: string;
  setName: string | null;
  setCode: string | null;
  cardName: string;
  cardNumber: string | null;
  variant: string | null;
  language: string | null;
  productKind: TcgProductKind;
  isGraded: boolean;
  gradingCompany: GradingCompany | null;
  grade: string | null;
  catalogSource: string;
  catalogExternalId: string;
  /** Confiance du côté catalogue (Pokémon TCG API) — indépendante de la confiance côté pricing. */
  confidence: number;
  warnings: string[];
}

/**
 * Résultat explicite d'une tentative de correspondance croisée catalogue ↔
 * pricing. `probable_match` et `ambiguous` ne sont **jamais** transformés en
 * prix exploitable automatiquement par le moteur — seule une décision
 * humaine ou un branchement futur explicite peut le faire (règle du LOT 3).
 */
export type TcgMatchOutcome = "exact_match" | "probable_match" | "ambiguous" | "no_match";

export interface TcgCrossMatchResult {
  outcome: TcgMatchOutcome;
  identity: TcgCanonicalIdentity;
  /** Vide sauf `exact_match`/`probable_match` (une seule entrée) ou `ambiguous` (plusieurs). */
  priceObservations: NormalizedPriceObservation[];
  confidence: number;
  warnings: string[];
}
