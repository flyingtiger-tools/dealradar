import type { AIProvider, AIProviderRequest, AIProviderResponse } from "@dealradar/ai";

export interface SimulatedProviderOptions {
  /** Latence artificielle par appel, en millisecondes — illustrative, jamais mesurée sur un vrai modèle. */
  latencyMs?: number;
  model?: string;
}

const DEFAULT_LATENCY_MS = 400;

/**
 * Provider factice utilisé quand aucune clé OpenAI réelle n'est configurée
 * (`OPENAI_API_KEY` absent). Il ne cherche JAMAIS à deviner mieux que
 * l'extraction déterministe : il retourne un JSON vide après un délai
 * artificiel, uniquement pour exercer le chemin de code (cache, budget,
 * télémétrie, agrégation) sans fabriquer une qualité d'extraction qui
 * n'existe pas. Toute métrique dérivée de ce provider est étiquetée
 * "simulé" dans le rapport — jamais comparée à une vraie performance IA.
 */
export function createSimulatedProvider(options: SimulatedProviderOptions = {}): AIProvider {
  const latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
  const model = options.model ?? "simulated-v1";

  return {
    name: "simulated",
    model,
    async extract(request: AIProviderRequest): Promise<AIProviderResponse> {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      const approxInputUnits = Math.ceil((request.system.length + request.userText.length) / 4);
      return {
        raw: {},
        usage: { inputUnits: approxInputUnits, outputUnits: 5 },
      };
    },
  };
}
