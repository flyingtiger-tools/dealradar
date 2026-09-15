import Constants from "expo-constants";
import type { TcgCardAnalysisResult, TcgCardProvidedHints } from "@dealradar/contracts";
import { getCurrentAccessToken } from "../auth/session";

/**
 * Client du pipeline TCG serverless synchrone (lot "journée autonome",
 * Priorité 7/8) — `POST /api/internal/tcg/analyze` (Vercel, apps/web) :
 * photo/indices → extraction → corroboration catalogue → pricing →
 * résultat, en UNE requête, sans file d'attente ni worker. Utilisé par
 * Scanner Pokémon en build interne (`INTERNAL_TOOLS_ENABLED`) tant que le
 * worker Railway n'est pas redéployé — voir `analyses-client.ts` pour le
 * chemin asynchrone (`POST /v1/analyses` + polling), inchangé et conservé
 * pour la production future (jamais supprimé, voir Priorité 8).
 */
function apiBaseUrl(): string {
  return (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:3000";
}

export class TcgAnalyzeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function requireAccessToken(): Promise<string> {
  const token = await getCurrentAccessToken();
  if (!token) throw new TcgAnalyzeError("UNAUTHENTICATED", "Aucune session active — connecte-toi avant de lancer une analyse.");
  return token;
}

export interface AnalyzeTcgCardParams {
  /** URL de stockage Supabase (`analysis-uploads/<userId>/...`) déjà uploadée — voir `tcg-upload-client.ts`. */
  imageUrl?: string;
  /** Saisie manuelle (nom/set/numéro/langue/variante) — chemin 100% déterministe, sans aucun appel IA. */
  providedTcgHints?: TcgCardProvidedHints;
}

export interface AnalyzeTcgCardResponse {
  status: "completed" | "insufficient_data" | "failed";
  result: TcgCardAnalysisResult;
}

/**
 * Appel synchrone unique — pas de polling : la réponse HTTP contient déjà
 * le résultat final (identifié ou non, prix trouvé ou non). Timeout réseau
 * standard `fetch()` (pas de délai personnalisé ici) : `maxDuration = 30`
 * côté route Vercel borne déjà la durée serveur.
 */
export async function analyzeTcgCard(params: AnalyzeTcgCardParams): Promise<AnalyzeTcgCardResponse> {
  if (!params.imageUrl && !params.providedTcgHints) {
    throw new TcgAnalyzeError("INVALID_REQUEST", "imageUrl ou providedTcgHints requis.");
  }
  const accessToken = await requireAccessToken();

  const response = await fetch(`${apiBaseUrl()}/api/internal/tcg/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new TcgAnalyzeError(body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `Erreur HTTP ${response.status}`);
  }

  return (await response.json()) as AnalyzeTcgCardResponse;
}
