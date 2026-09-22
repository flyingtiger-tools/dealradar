import Constants from "expo-constants";
import { z } from "zod";
import { getCurrentAccessToken } from "../auth/session";

/**
 * Client `GET /api/internal/operator/observability` (`apps/web`, LOT
 * "Interactive History + Generic Result UI + Full Cancellation + Pre-Prod
 * Activation Package", sections 4/5) — pont read-only vers
 * `getOperatorObservabilitySummary`/`checkHistoricalEngineAvailability`
 * (`@dealradar/ingestion`, server-only) : mobile n'appelle JAMAIS ces
 * fonctions directement (aucun client Supabase service role côté app).
 * Schéma Zod volontairement LÉGER (pas une réplique exhaustive de chaque
 * type serveur) — suffisant pour ne jamais laisser circuler un champ
 * `undefined`/mal typé vers l'écran, sans dupliquer l'intégralité du
 * contrat serveur dans le mobile (celui-ci reste interne, jamais un
 * contrat produit stable comme `AnalysisResult`).
 */

const sourceReadinessEntrySchema = z.object({ source: z.string(), readiness: z.string().optional() });

/**
 * Aligné CHAMP PAR CHAMP sur `OperatorObservabilitySummary` (`packages/
 * ingestion/src/operator-observability.ts`) — un schéma antérieur de ce
 * fichier divergeait silencieusement (`completedAt`/`success`/
 * `targetsClaimed`/`observationsOverTime`/`topIdentityConflictProducts`
 * n'existent PAS côté serveur, qui utilise `finishedAt`/`claimed`+
 * `succeeded`+`failed`/`observationsPersistedByDay`/
 * `topUnresolvedIdentityConflictProducts`) : corrigé lors de l'audit beta-
 * readiness (LOT "Product History UX + Source Health + Interactive
 * Cancellation + Beta Readiness", section 12) — ce décalage aurait fait
 * échouer la validation Zod de TOUTE réponse réelle du serveur.
 */
const sourceHealthRollupEntrySchema = z.object({
  source: z.string(),
  healthLevel: z.enum(["healthy", "degraded", "unhealthy"]),
  consecutiveFailures: z.number(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  requestsUsed: z.number(),
  abortedCount: z.number(),
  timeoutCount: z.number(),
  averageLatencyMs: z.number().nullable(),
});

const operatorObservabilitySummarySchema = z.object({
  generatedAt: z.string(),
  sourceReadiness: z.array(sourceReadinessEntrySchema),
  recentRuns: z.array(
    z.object({
      runKey: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      considered: z.number(),
      claimed: z.number(),
      succeeded: z.number(),
      failed: z.number(),
      timedOut: z.boolean(),
      budgetExhausted: z.boolean(),
    }),
  ),
  runCount: z.number(),
  successRate: z.number().nullable(),
  failedTargetsByReason: z.array(z.object({ reason: z.string(), count: z.number() })),
  sourceErrorCounts: z.array(z.object({ source: z.string(), count: z.number() })),
  dueTargetCount: z.number(),
  overdueTargetCount: z.number(),
  budgetExhaustedRunCount: z.number(),
  timedOutRunCount: z.number(),
  observationsPersistedByDay: z.record(z.string(), z.number()),
  topUnresolvedIdentityConflictProducts: z.array(z.object({ productKey: z.string(), conflictCount: z.number() })),
  sourceHealth: z.array(sourceHealthRollupEntrySchema),
  unhealthySources: z.array(z.string()),
  abortedTargetCount: z.number(),
  latestSuccessfulTargetAt: z.string().nullable(),
  sparseHistoryProductCount: z.number(),
});

const historicalEngineAvailabilitySchema = z.object({
  allTablesAvailable: z.boolean(),
  tables: z.array(z.object({ table: z.string(), available: z.boolean() })),
});

const operatorObservabilityResponseSchema = z.object({
  summary: operatorObservabilitySummarySchema,
  historicalEngine: historicalEngineAvailabilitySchema,
});

export type OperatorObservabilityResponse = z.infer<typeof operatorObservabilityResponseSchema>;

const REQUEST_TIMEOUT_MS = 15_000;

function apiBaseUrl(): string {
  return (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:3000";
}

export class OperatorObservabilityError extends Error {
  constructor(
    public readonly code: "AUTH_REQUIRED" | "NETWORK_UNAVAILABLE" | "REQUEST_TIMEOUT" | "BACKEND_UNAVAILABLE" | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "OperatorObservabilityError";
  }
}

/**
 * `null` sans session active — jamais un appel réseau non authentifié
 * (même discipline que `tcg-analyze-client.ts`).
 */
export async function fetchOperatorObservability(): Promise<OperatorObservabilityResponse> {
  const accessToken = await getCurrentAccessToken();
  if (!accessToken) throw new OperatorObservabilityError("AUTH_REQUIRED", "Aucune session active — connecte-toi avant de consulter les diagnostics.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl()}/api/internal/operator/observability`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new OperatorObservabilityError("REQUEST_TIMEOUT", "Le serveur a mis trop de temps à répondre.");
      }
      throw new OperatorObservabilityError("NETWORK_UNAVAILABLE", "Impossible de joindre le service — vérifie ta connexion et réessaie.");
    }

    if (!response.ok) {
      const code = response.status === 401 ? "AUTH_REQUIRED" : "BACKEND_UNAVAILABLE";
      throw new OperatorObservabilityError(code, "Impossible de lire les diagnostics opérateur.");
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new OperatorObservabilityError("INVALID_RESPONSE", "Réponse illisible du serveur.");
    }

    const parsed = operatorObservabilityResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new OperatorObservabilityError("INVALID_RESPONSE", "Réponse inattendue du serveur.");
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}
