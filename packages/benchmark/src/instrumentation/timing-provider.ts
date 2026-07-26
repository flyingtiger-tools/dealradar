import type { AIProvider, AIProviderRequest, AIProviderResponse } from "@dealradar/ai";

export interface ProviderTimings {
  totalMs: number;
  calls: number;
}

/**
 * Décore un `AIProvider` existant pour chronométrer extract() sans toucher
 * à `packages/ai` — pur enveloppement de l'interface déjà exportée. Marche
 * aussi bien pour le provider simulé de ce paquet que pour un vrai
 * `createOpenAiProvider()`.
 */
export function createTimingProvider(inner: AIProvider): { provider: AIProvider; timings: ProviderTimings } {
  const timings: ProviderTimings = { totalMs: 0, calls: 0 };

  const provider: AIProvider = {
    name: inner.name,
    model: inner.model,
    async extract(request: AIProviderRequest): Promise<AIProviderResponse> {
      const startedAt = performance.now();
      try {
        return await inner.extract(request);
      } finally {
        timings.totalMs += performance.now() - startedAt;
        timings.calls += 1;
      }
    },
  };

  return { provider, timings };
}
