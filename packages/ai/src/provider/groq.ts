import { fetchWithRetry, ProviderError, type FetchWithRetryOptions } from "./http";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./types";

/**
 * Troisième provider concret derrière `AIProvider` — même interface, même
 * infrastructure HTTP partagée (`fetchWithRetry`/`ProviderError`) que
 * `openai.ts`/`claude.ts`. API Chat Completions compatible OpenAI (mêmes
 * champs `messages`/`response_format`/`usage`), seule l'URL et le nom du
 * provider changent — aucune logique dupliquée au-delà de la forme du
 * payload, imposée par l'API elle-même.
 *
 * Aucun modèle codé en dur ici : `options.model` est toujours fourni par
 * l'appelant (couche config, jamais le métier — voir
 * `apps/workers/src/ingestion/ai-provider-config.ts`).
 */
const CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqProviderOptions {
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

export function createGroqProvider(options: GroqProviderOptions): AIProvider {
  return {
    name: "groq",
    model: options.model,
    async extract(request: AIProviderRequest): Promise<AIProviderResponse> {
      // Les images sont toujours incluses si présentes dans la requête —
      // aucune liste de modèles "supporte la vision" codée en dur ici. Si le
      // modèle configuré ne supporte pas les images, l'API Groq répondra une
      // erreur exploitable (ProviderError via fetchWithRetry), jamais un
      // filtrage silencieux côté client qui masquerait le vrai problème.
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
        throw new ProviderError("Réponse Groq sans contenu exploitable.", { code: "INVALID_RESPONSE" });
      }

      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch {
        throw new ProviderError("Réponse Groq n'est pas un JSON valide.", { code: "INVALID_RESPONSE" });
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
