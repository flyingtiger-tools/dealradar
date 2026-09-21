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

const operatorObservabilitySummarySchema = z.object({
  recentRuns: z.array(
    z.object({
      runKey: z.string(),
      startedAt: z.string(),
      completedAt: z.string().nullable(),
      success: z.boolean().nullable(),
      timedOut: z.boolean(),
      budgetExhausted: z.boolean(),
      targetsClaimed: z.number(),
      targetsSucceeded: z.number(),
      targetsFailed: z.number(),
    }),
  ),
  successRate: z.number().nullable(),
  failedTargetsByReason: z.array(z.object({ reason: z.string(), count: z.number() })),
  sourceErrorCounts: z.array(z.object({ source: z.string(), errorCount: z.number(), timeoutCount: z.number() })),
  dueTargetCount: z.number(),
  overdueTargetCount: z.number(),
  budgetExhaustedRunCount: z.number(),
  timedOutRunCount: z.number(),
  observationsOverTime: z.array(z.object({ day: z.string(), count: z.number() })),
  topIdentityConflictProducts: z.array(z.object({ productKey: z.string(), conflictCount: z.number() })),
  sourceReadiness: z.array(sourceReadinessEntrySchema),
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
