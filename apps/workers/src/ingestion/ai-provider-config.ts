import { createOpenAiProvider, type AIProvider } from "@dealradar/ai";
import { logger } from "../logger";

export interface AiExtractionConfig {
  provider: AIProvider;
  maxImages?: number;
  imageDomainAllowlist: string[];
  dailyBudgetUsd?: number;
}

/**
 * Construit la configuration d'extraction IA depuis l'environnement des
 * workers. Retourne `undefined` (jamais une erreur) si l'IA n'est pas
 * configurée — dégradation gracieuse : le pipeline continue en 100%
 * déterministe, même esprit que `connector-config.ts` pour eBay. Un seul
 * provider réel dans ce lot (`openai`) — toute autre valeur d'`AI_PROVIDER`
 * désactive l'IA plutôt que d'échouer silencieusement sur un provider
 * inexistant.
 */
export function buildAiExtractionConfigFromEnv(): AiExtractionConfig | undefined {
  const providerName = process.env.AI_PROVIDER;
  if (!providerName) return undefined;

  if (providerName !== "openai") {
    logger.warn(
      { providerName },
      "AI_PROVIDER non reconnu dans ce lot (seul 'openai' est implémenté) — extraction IA désactivée, repli déterministe.",
    );
    return undefined;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn("OPENAI_API_KEY absent — extraction IA désactivée, repli 100% déterministe.");
    return undefined;
  }

  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  const maxImages = process.env.AI_MAX_IMAGES ? Number(process.env.AI_MAX_IMAGES) : undefined;
  const imageDomainAllowlist = (process.env.AI_IMAGE_DOMAIN_ALLOWLIST ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
  const dailyBudgetUsd = process.env.AI_DAILY_BUDGET_USD ? Number(process.env.AI_DAILY_BUDGET_USD) : undefined;

  return {
    provider: createOpenAiProvider({ apiKey, model }),
    maxImages,
    imageDomainAllowlist,
    dailyBudgetUsd,
  };
}
