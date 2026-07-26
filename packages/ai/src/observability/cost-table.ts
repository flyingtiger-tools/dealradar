/**
 * Table tarifaire versionnée et datée — jamais une vérité codée en dur.
 * Un seul provider réel dans ce lot (OpenAI) ; toute autre ligne (ex.
 * Anthropic) resterait un exemple documentaire, jamais utilisée par le code.
 *
 * Sources (à reconfirmer périodiquement, les tarifs évoluent) :
 * - GPT-4o-mini : https://devtk.ai/en/models/gpt-4o-mini/ ($0.15 / $0.60 par million de tokens, entrée/sortie).
 */
export interface CostTableEntry {
  provider: string;
  model: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  /** Date ISO à partir de laquelle ce tarif est considéré valide — pas une garantie permanente. */
  effectiveFrom: string;
}

export const COST_TABLE: CostTableEntry[] = [
  {
    provider: "openai",
    model: "gpt-4o-mini",
    inputPerMTokUsd: 0.15,
    outputPerMTokUsd: 0.6,
    effectiveFrom: "2026-01-01",
  },
];

export function findCostTableEntry(provider: string, model: string): CostTableEntry | null {
  return COST_TABLE.find((entry) => entry.provider === provider && entry.model === model) ?? null;
}

/**
 * Estimation de coût — jamais une facture officielle du provider, seulement
 * un calcul à partir des unités retournées par l'API et de cette table.
 * Si le modèle n'est pas répertorié, retourne `null` plutôt que d'inventer
 * un tarif (même philosophie "pas de fausse précision" que le reste du projet).
 */
export function estimateCostUsd(
  usage: { inputUnits: number; outputUnits: number },
  entry: CostTableEntry | null,
): number | null {
  if (!entry) return null;
  return (usage.inputUnits / 1_000_000) * entry.inputPerMTokUsd + (usage.outputUnits / 1_000_000) * entry.outputPerMTokUsd;
}
