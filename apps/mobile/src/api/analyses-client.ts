import Constants from "expo-constants";
import { analysisRequestSchema, analysisResponseSchema, type AnalysisRequest, type AnalysisResponse } from "@dealradar/contracts";
import { getCurrentAccessToken } from "../auth/session";

/**
 * Client du contrat universel d'analyse (ADR 0010,
 * `docs/mobile/api-contract.md`). Ne construit jamais l'estimation/le score
 * lui-même — appelle l'API, affiche ce qu'elle retourne.
 *
 * Le jeton d'accès n'est plus jamais un paramètre saisi par l'appelant
 * (LOT 9) — il vient systématiquement de la session Supabase courante
 * (`auth/session.ts`), jamais d'un champ de saisie manuel.
 */
function apiBaseUrl(): string {
  return (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:3000";
}

export class AnalysesApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function requireAccessToken(): Promise<string> {
  const token = await getCurrentAccessToken();
  if (!token) throw new AnalysesApiError("UNAUTHENTICATED", "Aucune session active — connecte-toi avant de lancer une analyse.");
  return token;
}

async function parseErrorResponse(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  throw new AnalysesApiError(body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `Erreur HTTP ${response.status}`);
}

export async function createAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  const accessToken = await requireAccessToken();
  const body = analysisRequestSchema.parse(request);

  const response = await fetch(`${apiBaseUrl()}/api/v1/analyses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) await parseErrorResponse(response);
  const json = await response.json();
  return analysisResponseSchema.parse(json);
}

export async function getAnalysis(id: string): Promise<AnalysisResponse> {
  const accessToken = await requireAccessToken();
  const response = await fetch(`${apiBaseUrl()}/api/v1/analyses/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) await parseErrorResponse(response);
  const json = await response.json();
  return analysisResponseSchema.parse(json);
}

/**
 * Annulation INTERACTIVE (LOT "Product History UX + Source Health +
 * Interactive Cancellation + Beta Readiness", section 6/7) — appelle
 * `POST /v1/analyses/:id/cancel`, qui pose `cancel_requested_at` côté
 * serveur (migration 0026) si la requête est encore `pending`/`processing`.
 * `cancelRequested: true` signifie seulement que la DEMANDE a été
 * enregistrée : le worker (`apps/workers/src/jobs/process-analysis.ts`)
 * consulte lui-même cette colonne avant ses étapes coûteuses, jamais une
 * annulation instantanée garantie. Best-effort côté appelant — une erreur
 * ici ne doit jamais empêcher l'UI de revenir à l'état local idle (voir
 * `UniversalScanScreen.tsx`).
 */
export async function cancelAnalysis(id: string): Promise<{ id: string; cancelRequested: boolean }> {
  const accessToken = await requireAccessToken();
  const response = await fetch(`${apiBaseUrl()}/api/v1/analyses/${id}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) await parseErrorResponse(response);
  return (await response.json()) as { id: string; cancelRequested: boolean };
}

/**
 * Signale un arrêt du POLLING CÔTÉ CLIENT (LOT "Product History UX...",
 * section 6/7) — distinct d'une erreur serveur : ne doit jamais être
 * affiché comme un échec d'analyse, juste comme une sortie propre de la
 * boucle d'attente. Le statut serveur réel (`"cancelled"` ou autre) reste
 * géré séparément par `cancelAnalysis()`/le worker.
 */
export class AnalysisPollAbortedError extends Error {
  constructor() {
    super("Le suivi de l'analyse a été arrêté côté client.");
  }
}

/**
 * Polling simple — pas de webhook dans ce lot (voir `docs/mobile/api-
 * contract.md`). `signal` (LOT "Product History UX...", section 6/7) permet
 * à l'appelant d'arrêter IMMÉDIATEMENT le polling (jamais d'attendre le
 * prochain intervalle) indépendamment de l'état serveur — complémentaire à
 * `cancelAnalysis()`, jamais un substitut : le serveur/worker ignore
 * totalement ce `signal`, qui ne contrôle que la boucle locale.
 */
export async function pollAnalysisUntilSettled(
  id: string,
  options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AnalysisResponse> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (options.signal?.aborted) throw new AnalysisPollAbortedError();
    const current = await getAnalysis(id);
    if (current.status !== "pending" && current.status !== "processing") return current;
    if (Date.now() >= deadline) return current;
    if (options.signal?.aborted) throw new AnalysisPollAbortedError();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
