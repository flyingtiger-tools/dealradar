import {
  createOpenAiProvider,
  createClaudeProvider,
  createGroqProvider,
  createOpenRouterProvider,
  TCG_CARD_PROMPT_VERSION,
  TCG_CARD_EXTRACTION_SCHEMA_VERSION,
  type AIProvider,
  type ExtractTcgCardOptions,
} from "@dealradar/ai";
import { createSupabaseExtractionCache, createSupabaseBudgetGuard } from "@dealradar/ingestion";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";

/**
 * Équivalent web (`/api/internal/tcg/analyze`, lot "journée autonome") de
 * `apps/workers/src/ingestion/ai-provider-config.ts` — même logique de
 * wiring exact (un provider réel par `AI_PROVIDER`, dégradation gracieuse
 * vers `undefined` si la clé correspondante est absente), dupliquée
 * intentionnellement ici : chaque app lit son PROPRE environnement de
 * déploiement (Vercel pour celle-ci, Railway pour les workers), jamais un
 * import cross-app (aucune app de ce monorepo n'en importe une autre).
 *
 * Défaut Groq = `qwen/qwen3.6-27b` (voir `packages/ai/src/provider/
 * capabilities.ts`, relevé le 2026-09-15) — seul modèle vision GRATUIT
 * (tier Developer, sans carte) déjà intégré sans changement de code
 * (`groq.ts` envoie déjà les images, aucune liste de modèles en dur).
 */
const DEFAULT_MODEL_BY_PROVIDER: Record<"openai" | "anthropic" | "groq" | "openrouter", string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  groq: "qwen/qwen3.6-27b",
  openrouter: "openai/gpt-4o-mini",
};

export interface TcgAiExtractionConfig {
  extractionOptions: ExtractTcgCardOptions;
}

function buildProvider(): AIProvider | undefined {
  const providerName = env.AI_PROVIDER;
  if (!providerName) return undefined;

  if (providerName === "openai") {
    if (!env.OPENAI_API_KEY) return undefined;
    return createOpenAiProvider({ apiKey: env.OPENAI_API_KEY, model: env.AI_MODEL ?? DEFAULT_MODEL_BY_PROVIDER.openai });
  }
  if (providerName === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) return undefined;
    return createClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL ?? DEFAULT_MODEL_BY_PROVIDER.anthropic });
  }
  if (providerName === "groq") {
    if (!env.GROQ_API_KEY) return undefined;
    return createGroqProvider({ apiKey: env.GROQ_API_KEY, model: env.AI_MODEL ?? DEFAULT_MODEL_BY_PROVIDER.groq });
  }
  if (providerName === "openrouter") {
    if (!env.OPENROUTER_API_KEY) return undefined;
    return createOpenRouterProvider({ apiKey: env.OPENROUTER_API_KEY, model: env.AI_MODEL ?? DEFAULT_MODEL_BY_PROVIDER.openrouter });
  }
  return undefined;
}

/** `undefined` (jamais une erreur) si l'IA n'est pas configurée — même dégradation gracieuse que côté workers. */
export function buildTcgAiExtractionConfig(db: SupabaseClient): TcgAiExtractionConfig | undefined {
  const provider = buildProvider();
  if (!provider) return undefined;

  const cache = createSupabaseExtractionCache(db, {
    provider: provider.name,
    model: provider.model,
    promptVersion: TCG_CARD_PROMPT_VERSION,
    schemaVersion: TCG_CARD_EXTRACTION_SCHEMA_VERSION,
    deterministicVersion: 0,
  });
  const budgetGuard = createSupabaseBudgetGuard(db, {
    provider: provider.name,
    model: provider.model,
    dailyBudgetUsd: env.AI_DAILY_BUDGET_USD ?? 0,
    listingId: null,
  });

  return { extractionOptions: { provider, cache, budgetGuard } };
}
