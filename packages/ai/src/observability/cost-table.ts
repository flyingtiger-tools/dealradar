/**
 * Table tarifaire versionnée et datée — jamais une vérité codée en dur.
 * Deux providers réels : OpenAI et Anthropic (LOT Claude).
 *
 * Sources (à reconfirmer périodiquement, les tarifs évoluent) :
 * - GPT-4o-mini : https://devtk.ai/en/models/gpt-4o-mini/ ($0.15 / $0.60 par million de tokens, entrée/sortie).
 * - Claude Haiku 4.5 / Sonnet 5 : https://platform.claude.com/docs/en/about-claude/pricing (relevé le 2026-08-02).
 *   Sonnet 5 est en tarif introductif ($2/$10) jusqu'au 2026-08-31 ; passera à
 *   $3/$15 ensuite — cette table ne gère pas les tarifs datés multiples pour
 *   un même modèle, à mettre à jour manuellement à cette date.
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
  {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    inputPerMTokUsd: 1,
    outputPerMTokUsd: 5,
    effectiveFrom: "2026-08-02",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputPerMTokUsd: 2,
    outputPerMTokUsd: 10,
    effectiveFrom: "2026-08-02",
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
