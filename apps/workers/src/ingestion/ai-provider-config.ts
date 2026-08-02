import { createOpenAiProvider, createClaudeProvider, type AIProvider } from "@dealradar/ai";
import { logger } from "../logger";

export interface AiExtractionConfig {
  provider: AIProvider;
  maxImages?: number;
  imageDomainAllowlist: string[];
  dailyBudgetUsd?: number;
}

/** Modèle par défaut si `AI_MODEL` n'est pas surchargé — jamais utilisé pour un provider autre que celui dont il porte le nom. */
const DEFAULT_MODEL_BY_PROVIDER: Record<"openai" | "anthropic", string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
};

/**
 * Construit la configuration d'extraction IA depuis l'environnement des
 * workers. Retourne `undefined` (jamais une erreur) si l'IA n'est pas
 * configurée — dégradation gracieuse : le pipeline continue en 100%
 * déterministe, même esprit que `connector-config.ts` pour eBay.
 *
 * Deux providers réels (`openai`, `anthropic`), sélectionnés uniquement via
 * `AI_PROVIDER` — chaque branche est isolée et ne retourne que sa propre
 * variable de clé (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) : si le provider
 * choisi n'a pas sa clé, l'IA est désactivée (repli déterministe), jamais un
 * repli silencieux vers l'autre provider même si sa clé est présente par
 * ailleurs dans l'environnement.
 */
export function buildAiExtractionConfigFromEnv(): AiExtractionConfig | undefined {
  const providerName = process.env.AI_PROVIDER;
  if (!providerName) return undefined;

  const maxImages = process.env.AI_MAX_IMAGES ? Number(process.env.AI_MAX_IMAGES) : undefined;
  const imageDomainAllowlist = (process.env.AI_IMAGE_DOMAIN_ALLOWLIST ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
  const dailyBudgetUsd = process.env.AI_DAILY_BUDGET_USD ? Number(process.env.AI_DAILY_BUDGET_USD) : undefined;

  if (providerName === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn("OPENAI_API_KEY absent — extraction IA désactivée, repli 100% déterministe.");
      return undefined;
    }
    const model = process.env.AI_MODEL ?? DEFAULT_MODEL_BY_PROVIDER.openai;
    return { provider: createOpenAiProvider({ apiKey, model }), maxImages, imageDomainAllowlist, dailyBudgetUsd };
  }

  if (providerName === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logger.warn("ANTHROPIC_API_KEY absent — extraction IA désactivée, repli 100% déterministe.");
      return undefined;
    }
    const model = process.env.AI_MODEL ?? DEFAULT_MODEL_BY_PROVIDER.anthropic;
    return { provider: createClaudeProvider({ apiKey, model }), maxImages, imageDomainAllowlist, dailyBudgetUsd };
  }

  logger.warn(
    { providerName },
    "AI_PROVIDER non reconnu ('openai' ou 'anthropic' uniquement) — extraction IA désactivée, repli déterministe.",
  );
  return undefined;
}
