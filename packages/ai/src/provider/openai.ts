import { fetchWithRetry, ProviderError, type FetchWithRetryOptions } from "./http";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./types";

/**
 * Seul provider implémenté dans ce lot. Choix concret d'API isolé
 * entièrement ici : la V1 utilise Chat Completions (`response_format:
 * json_object`) pour la disponibilité immédiate du modèle mini choisi ;
 * l'orchestrateur (`extraction/extract-product.ts`) ne connaît que
 * `AIProvider.extract()` et ignore ce choix. Migration vers l'API Responses
 * (chemin moderne recommandé par OpenAI) documentée dans l'ADR 0009 — ne
 * nécessiterait aucun changement en dehors de ce fichier.
 */
const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchWithRetryOptions["fetchImpl"];
  timeoutMs?: number;
  maxRetries?: number;
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAiProvider(options: OpenAiProviderOptions): AIProvider {
  return {
    name: "openai",
    model: options.model,
    async extract(request: AIProviderRequest): Promise<AIProviderResponse> {
      const body = {
        model: options.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          {
            role: "user",
            content: [
              { type: "text", text: request.userText },
              ...request.images.map((image) => ({ type: "image_url", image_url: { url: image.url } })),
            ],
          },
        ],
      };

      const responseJson = (await fetchWithRetry(
        CHAT_COMPLETIONS_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, maxRetries: options.maxRetries },
      )) as ChatCompletionsResponse;

      const content = responseJson.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ProviderError("Réponse OpenAI sans contenu exploitable.", { code: "INVALID_RESPONSE" });
      }

      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch {
        throw new ProviderError("Réponse OpenAI n'est pas un JSON valide.", { code: "INVALID_RESPONSE" });
      }

      return {
        raw,
        usage: {
          inputUnits: responseJson.usage?.prompt_tokens ?? 0,
          outputUnits: responseJson.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
