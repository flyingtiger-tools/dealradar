/**
 * Table de capacités par modèle (Phase 18, "long lot local") — même
 * philosophie que `observability/cost-table.ts` : une table versionnée et
 * datée, jamais une supposition. Objectif explicite : ne jamais tenter
 * d'envoyer une image à un modèle texte-only. Un modèle absent de cette
 * table retourne `null` (capacités INCONNUES), jamais une capacité devinée
 * par défaut (ni `true` "on suppose que ça marche", ni `false` "on suppose
 * que ça bloque tout") — l'appelant doit alors décider explicitement quoi
 * faire d'une capacité inconnue (voir `packages/benchmark/src/tcg/run-tcg-example.ts`,
 * qui refuse de tenter l'appel uniquement si `vision === false` est
 * CONNU, jamais sur une simple absence de la table).
 *
 * Volontairement PAS ajoutée à l'interface `AIProvider` elle-même (types.ts)
 * — les capacités dépendent du MODÈLE choisi, pas seulement du provider, et
 * les 4 factories existantes (openai.ts/claude.ts/groq.ts/openrouter.ts)
 * acceptent un `model: string` arbitraire fourni par l'appelant sans
 * connaissance de ses capacités réelles. Une table séparée, consultée par
 * qui en a besoin (ici, le benchmark), évite de faire porter cette
 * connaissance à chaque provider concret pour un besoin qui n'existe
 * aujourd'hui que côté benchmark.
 */
export interface AIProviderCapabilities {
  vision: boolean;
  jsonMode: boolean;
  usageReporting: boolean;
}

interface CapabilityTableEntry {
  provider: string;
  model: string;
  capabilities: AIProviderCapabilities;
  /** Date ISO du relevé — pas une garantie permanente, les catalogues de modèles évoluent. */
  notedAt: string;
}

/**
 * Relevé le 2026-09-10. `llama-3.3-70b-versatile` (modèle Groq par défaut de
 * la matrice benchmark, voir `packages/benchmark/src/tcg/cli-tcg.ts`) est un
 * modèle TEXTE SEUL — jamais vérifié comme acceptant une image en entrée.
 * C'est exactement le cas que ce mécanisme existe pour attraper : le
 * benchmark TCG envoie toujours une photo, `runTcgExample()` doit donc
 * signaler `skipped_unsupported_capability` pour cette entrée de matrice
 * plutôt que de tenter un appel dont le comportement serait indéfini côté
 * Groq (jamais vérifié en réel dans ce lot, COÛT = 0).
 */
const CAPABILITY_TABLE: CapabilityTableEntry[] = [
  { provider: "openai", model: "gpt-4o-mini", capabilities: { vision: true, jsonMode: true, usageReporting: true }, notedAt: "2026-01-01" },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    capabilities: { vision: true, jsonMode: true, usageReporting: true },
    notedAt: "2026-08-02",
  },
  { provider: "anthropic", model: "claude-sonnet-5", capabilities: { vision: true, jsonMode: true, usageReporting: true }, notedAt: "2026-08-02" },
  {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    capabilities: { vision: false, jsonMode: true, usageReporting: true },
    notedAt: "2026-09-10",
  },
  /**
   * Relevé le 2026-09-15 (`console.groq.com/docs/vision`, documentation
   * officielle, jamais une note d'un tiers) — modèle vision GRATUIT (tier
   * Developer/no-card, confirmé via `console.groq.com/docs/rate-limits` :
   * 30 req/min, 1000 req/jour pour ce modèle précis), production-ready
   * (pas "preview"), jusqu'à 5 images/requête, 20 Mo max/image, JSON mode
   * supporté. Choisi comme provider vision par défaut pour l'extraction TCG
   * (voir docs/mobile/vision-provider-evaluation.md) précisément parce
   * qu'il ne nécessite aucun changement de code : `groq.ts` envoie déjà les
   * images en `image_url` sans liste de modèles codée en dur.
   */
  {
    provider: "groq",
    model: "qwen/qwen3.6-27b",
    capabilities: { vision: true, jsonMode: true, usageReporting: true },
    notedAt: "2026-09-15",
  },
  {
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    capabilities: { vision: true, jsonMode: true, usageReporting: true },
    notedAt: "2026-09-10",
  },
];

/** `null` si le modèle est absent de la table — capacités INCONNUES, jamais devinées. */
export function findProviderCapabilities(provider: string, model: string): AIProviderCapabilities | null {
  return CAPABILITY_TABLE.find((entry) => entry.provider === provider && entry.model === model)?.capabilities ?? null;
}
