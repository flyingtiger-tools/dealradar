import type { TrendSignal, TrendSignalConnector, TrendSource } from "./types";

/**
 * Connecteur de tendance factice pour tester le contrat sans dépendre d'un
 * vrai fournisseur (Agent Reach ou autre) — aucun appel réseau, aucune
 * clé, aucune donnée réelle.
 */
export function createMockTrendSignalConnector(source: TrendSource, signals: TrendSignal[]): TrendSignalConnector {
  return {
    source,
    async fetchSignal(): Promise<TrendSignal[]> {
      return signals;
    },
  };
}
