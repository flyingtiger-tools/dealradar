import { fetchWithRetry, ProviderError, type FetchWithRetryOptions } from "./http";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./types";

/**
 * Quatrième provider concret derrière `AIProvider` — même interface, même
 * infrastructure HTTP partagée que `openai.ts`/`claude.ts`/`groq.ts`. API
 * Chat Completions compatible OpenAI (OpenRouter route vers des dizaines de
 * modèles sous-jacents avec la même forme de requête/réponse) — seule
 * l'URL, le nom du provider et deux en-têtes optionnels changent.
 *
 * Aucun modèle codé en dur : `options.model` (ex. "openai/gpt-4o-mini",
 * "anthropic/claude-haiku-4.5") est toujours fourni par l'appelant (couche
 * config, jamais le métier).
 */
const CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterProviderOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchWithRetryOptions["fetchImpl"];
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * En-têtes d'attribution optionnels documentés par OpenRouter (classement
   * sur openrouter.ai) — jamais exigés pour que l'API fonctionne, jamais de
   * valeur inventée ici : omis des en-têtes envoyés si non fournis.
   */
  httpReferer?: string;
  appTitle?: string;
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions): AIProvider {
  return {
    name: "openrouter",
    model: options.model,
    async extract(request: AIProviderRequest): Promise<AIProviderResponse> {
      // Même règle que groq.ts : les images sont toujours incluses si
      // présentes, aucune liste de modèles "supporte la vision" codée en
      // dur — si le modèle routé ne les supporte pas, l'API répond une
      // erreur exploitable via ProviderError, jamais un filtrage silencieux.
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

      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      };
      if (options.httpReferer) headers["HTTP-Referer"] = options.httpReferer;
      if (options.appTitle) headers["X-Title"] = options.appTitle;

      const responseJson = (await fetchWithRetry(
        CHAT_COMPLETIONS_URL,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, maxRetries: options.maxRetries },
      )) as ChatCompletionsResponse;

      const content = responseJson.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ProviderError("Réponse OpenRouter sans contenu exploitable.", { code: "INVALID_RESPONSE" });
      }

      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch {
        throw new ProviderError("Réponse OpenRouter n'est pas un JSON valide.", { code: "INVALID_RESPONSE" });
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
