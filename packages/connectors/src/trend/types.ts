/**
 * Proposition d'architecture pour un futur signal de tendance (Phase 10,
 * ADR 0013) — ex. Agent Reach comme fournisseur possible parmi d'autres.
 * PREPARED uniquement : aucune intégration réelle, aucun appel réseau,
 * aucune connexion à Reddit/X/YouTube dans ce lot.
 *
 * RÈGLE ABSOLUE : un `TrendSignal` n'assigne jamais seul la valeur d'un
 * produit. Il ne peut qu'ENRICHIR un signal de demande/tendance/risque déjà
 * calculé ailleurs (Intelligence Core, `packages/core`) — jamais remplacer
 * `marketValueEstimate`/`decision`. `kind: "trend_signal"` (jamais une autre
 * valeur) rend ce type structurellement impossible à confondre avec
 * `NormalizedPriceObservation`/`ThirdPartyPriceHint` (../types.ts, ADR
 * 0012) : aucun champ de prix ici, et un futur code qui accepterait un
 * union `market evidence | trend signal` peut discriminer sur `kind` sans
 * ambiguïté. Voir `docs/ai-ingestion-foundation.md` (section 8) pour
 * comment ce signal pourrait un jour contribuer à Raf sans jamais modifier
 * directement la valeur marché.
 *
 * `TrendSignalConnector` n'étend PAS `ConnectorDescriptor` (../types.ts) :
 * une 6ᵉ famille de connecteurs nécessiterait sa propre extension d'ADR 0012
 * (même règle que l'ADR 0013 l'a fait pour la 5ᵉ, "Identification
 * Connectors") — non tranché dans ce lot, donc ce type reste délibérément
 * hors du vocabulaire `ConnectorFamily` partagé jusqu'à cette décision.
 */

export type TrendSource = "reddit" | "x" | "youtube" | "web" | "other";

export type TrendDirection = "up" | "down" | "flat" | "unknown";

export interface TrendSignalQuery {
  categorySlug: string;
  /** Bag ouvert — même convention que `CatalogQuery.hints`/`PricingQuery.hints` (../types.ts). */
  hints: Record<string, unknown>;
  window: "24h" | "7d" | "30d";
}

export interface TrendSignal {
  /** Discriminant fixe — jamais une autre valeur. Distingue structurellement ce type d'une preuve de marché (voir la règle absolue ci-dessus). */
  kind: "trend_signal";
  source: TrendSource;
  trendDirection: TrendDirection;
  /** null si la source ne fournit pas de volume exploitable — jamais 0 par défaut. */
  mentionVolume: number | null;
  /** Variation relative sur la fenêtre — null si non calculable (ex. pas de point de comparaison). */
  velocity: number | null;
  /** -1 (négatif) à 1 (positif) — optionnel, certaines sources n'exposent aucun sentiment exploitable. */
  sentiment: number | null;
  confidence: number;
  sourceCount: number;
  window: TrendSignalQuery["window"];
  warnings: string[];
}

export interface TrendSignalConnector {
  readonly source: TrendSource;
  fetchSignal(query: TrendSignalQuery): Promise<TrendSignal[]>;
}
