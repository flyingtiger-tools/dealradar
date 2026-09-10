import {
  createOpenAiProvider,
  createClaudeProvider,
  createGroqProvider,
  createOpenRouterProvider,
  type AIProvider,
} from "@dealradar/ai";
import { createSimulatedProvider } from "../provider/simulated";
import type { ProviderMatrixEntry } from "./types";

export interface BuiltMatrixProvider {
  entry: ProviderMatrixEntry;
  provider: AIProvider;
  mode: "simulated" | "live";
}

/**
 * Construit un `AIProvider` pour une entrée de matrice. Mode "simulated"
 * (défaut absolu de ce lot, COÛT = 0) : ignore complètement la clé réelle,
 * retourne toujours `createSimulatedProvider()` — jamais un appel réseau,
 * quel que soit le contenu de `process.env`. Le `model` demandé est
 * conservé sur le provider simulé uniquement pour l'étiquetage du rapport
 * (`entry` reste la source de vérité sur ce qui était réellement visé).
 *
 * Mode "live" existe pour permettre un vrai run plus tard (réutilise les
 * quatre factories existantes, jamais une cinquième implémentation) — mais
 * n'est jamais choisi par défaut : voir `cli.ts`, qui exige un flag
 * explicite ET la clé réelle correspondante avant de l'emprunter.
 */
export function buildProviderForMatrixEntry(entry: ProviderMatrixEntry, options: { live?: boolean } = {}): BuiltMatrixProvider {
  if (!options.live) {
    return { entry, provider: createSimulatedProvider({ model: entry.model }), mode: "simulated" };
  }

  const apiKey = apiKeyEnvVarFor(entry.provider);
  const realKey = process.env[apiKey];
  if (!realKey) {
    // Jamais un appel réseau sans clé réelle — repli honnête sur le simulé,
    // jamais une erreur qui bloquerait le reste de la matrice.
    return { entry, provider: createSimulatedProvider({ model: entry.model }), mode: "simulated" };
  }

  switch (entry.provider) {
    case "openai":
      return { entry, provider: createOpenAiProvider({ apiKey: realKey, model: entry.model }), mode: "live" };
    case "anthropic":
      return { entry, provider: createClaudeProvider({ apiKey: realKey, model: entry.model }), mode: "live" };
    case "groq":
      return { entry, provider: createGroqProvider({ apiKey: realKey, model: entry.model }), mode: "live" };
    case "openrouter":
      return { entry, provider: createOpenRouterProvider({ apiKey: realKey, model: entry.model }), mode: "live" };
  }
}

function apiKeyEnvVarFor(provider: ProviderMatrixEntry["provider"]): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
  }
}
