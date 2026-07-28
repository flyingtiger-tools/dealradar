import Constants from "expo-constants";
import { analysisRequestSchema, analysisResponseSchema, type AnalysisRequest, type AnalysisResponse } from "@dealradar/contracts";

/**
 * Client du contrat universel d'analyse (ADR 0010,
 * `docs/mobile/api-contract.md`). Ne construit jamais l'estimation/le score
 * lui-même — appelle l'API, affiche ce qu'elle retourne.
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

async function parseErrorResponse(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  throw new AnalysesApiError(body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `Erreur HTTP ${response.status}`);
}

export async function createAnalysis(accessToken: string, request: AnalysisRequest): Promise<AnalysisResponse> {
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

export async function getAnalysis(accessToken: string, id: string): Promise<AnalysisResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/v1/analyses/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) await parseErrorResponse(response);
  const json = await response.json();
  return analysisResponseSchema.parse(json);
}

/** Polling simple — pas de webhook dans ce lot (voir `docs/mobile/api-contract.md`). */
export async function pollAnalysisUntilSettled(
  accessToken: string,
  id: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<AnalysisResponse> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const current = await getAnalysis(accessToken, id);
    if (current.status !== "pending" && current.status !== "processing") return current;
    if (Date.now() >= deadline) return current;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
