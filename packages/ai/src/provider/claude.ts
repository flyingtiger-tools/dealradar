import { fetchWithRetry, ProviderError, type FetchWithRetryOptions } from "./http";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./types";

/**
 * Second provider concret derrière `AIProvider` — même interface que
 * `openai.ts`, même infrastructure HTTP partagée (`fetchWithRetry`/
 * `ProviderError`), donc les mêmes garanties de retry/timeout/429/5xx sans
 * code dupliqué. Utilise l'API Messages d'Anthropic avec une image
 * référencée par URL (`source.type: "url"`, supportée nativement — pas de
 * téléchargement/ré-encodage base64 nécessaire, même simplicité que le
 * provider OpenAI).
 */
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Suffisant pour le petit schéma JSON d'extraction TCG (9 champs + confiances) — jamais un texte libre long. */
const MAX_TOKENS = 1024;

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchWithRetryOptions["fetchImpl"];
  timeoutMs?: number;
  maxRetries?: number;
}

interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createClaudeProvider(options: ClaudeProviderOptions): AIProvider {
  return {
    name: "anthropic",
    model: options.model,
    async extract(request: AIProviderRequest): Promise<AIProviderResponse> {
      const body = {
        model: options.model,
        max_tokens: MAX_TOKENS,
        // Le prompt système est un paramètre de premier niveau côté Anthropic
        // (jamais un message `role: "system"` comme chez OpenAI) — seule
        // différence structurelle notable, invisible pour l'appelant.
        system: request.system,
        messages: [
          {
            role: "user",
            content: [
              // Images avant texte : recommandation officielle Anthropic pour de meilleurs résultats.
              ...request.images.map((image) => ({ type: "image", source: { type: "url", url: image.url } })),
              { type: "text", text: request.userText },
            ],
          },
        ],
      };

      const responseJson = (await fetchWithRetry(
        MESSAGES_URL,
        {
          method: "POST",
          headers: {
            "x-api-key": options.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, maxRetries: options.maxRetries },
      )) as AnthropicMessagesResponse;

      const textBlock = responseJson.content?.find((block) => block.type === "text");
      const content = textBlock?.text;
      if (typeof content !== "string") {
        throw new ProviderError("Réponse Claude sans contenu texte exploitable.", { code: "INVALID_RESPONSE" });
      }

      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch {
        throw new ProviderError("Réponse Claude n'est pas un JSON valide.", { code: "INVALID_RESPONSE" });
      }

      return {
        raw,
        usage: {
          inputUnits: responseJson.usage?.input_tokens ?? 0,
          outputUnits: responseJson.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}
