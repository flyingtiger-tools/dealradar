/**
 * Modèle de domaine de l'historique local (LOT "beta product readiness",
 * Phase 12). Volontairement découplé du contrat réseau
 * (`TcgCardAnalysisResult`) — un `HistoryEntry` est ce qui reste utile une
 * fois l'analyse terminée, jamais la charge réseau brute (pas de
 * base64/image, pas de token, pas de champ technique interne, voir Phase
 * 12 : "ne sauvegarde pas secrets/tokens/énorme base64 d'image").
 */

export type HistoryCategory = "pokemon_tcg";

export interface HistoryIdentity {
  name: string | null;
  setName: string | null;
  collectorNumber: string | null;
  language: string | null;
  variant: string | null;
}

export interface HistoryMarketValue {
  low: number;
  high: number;
  currency: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  category: HistoryCategory;
  identity: HistoryIdentity;
  /** Reflète `analysisDecisionSchema` (`@dealradar/contracts`) quand disponible — `null` pour un résultat TCG aujourd'hui (aucune décision produite, voir `theme/raf-mapping.ts`). Jamais une valeur inventée. */
  verdict: "BUY" | "REVIEW" | "PASS" | "INSUFFICIENT_DATA" | null;
  /** `null` si aucun prix n'a été trouvé — une carte identifiée sans prix reste historisée (Phase 13/14). */
  marketValue: HistoryMarketValue | null;
  /** 0-100, dérivé de la confiance d'identité (jamais 0-1 mélangé — voir Phase 29). */
  confidence: number | null;
  /** Libellé de source lisible (ex. "tcgdex", "cardmarket") — jamais un nom technique interne exposé sans traduction (Phase 28). */
  source: string | null;
  favorite: boolean;
  /** Clé de produit stable (Phase 22, `history/product-key.ts`) — utilisée pour la détection de doublon, jamais recalculée différemment ailleurs. */
  productKey: string;
}

export interface HistoryManifest {
  schemaVersion: number;
  entries: HistoryEntry[];
}

export const HISTORY_SCHEMA_VERSION = 1;
/** Limite de conservation locale (Phase 15) — au-delà, les entrées les plus anciennes sont supprimées automatiquement. */
export const HISTORY_MAX_ENTRIES = 200;

export function emptyHistoryManifest(): HistoryManifest {
  return { schemaVersion: HISTORY_SCHEMA_VERSION, entries: [] };
}
