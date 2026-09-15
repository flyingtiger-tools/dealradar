import Constants from "expo-constants";
import { z } from "zod";
import { tcgCardAnalysisResultSchema, type TcgCardAnalysisResult, type TcgCardProvidedHints } from "@dealradar/contracts";
import { getCurrentAccessToken } from "../auth/session";
import { recordAnalysisError, recordAnalysisSuccess } from "../diagnostics/diagnostics-store";
import type { AnalysisErrorCode } from "../domain/analysis-errors";

/**
 * Client du pipeline TCG serverless synchrone (lot "journée autonome",
 * Priorité 7/8 — durci au LOT "beta product readiness", Phases 1/3/4/5/8) —
 * `POST /api/internal/tcg/analyze` (Vercel, apps/web) : photo/indices →
 * extraction → corroboration catalogue → pricing → résultat, en UNE
 * requête, sans file d'attente ni worker. Utilisé par Scanner Pokémon en
 * build interne (`INTERNAL_TOOLS_ENABLED`) tant que le worker Railway
 * n'est pas redéployé — voir `analyses-client.ts` pour le chemin
 * asynchrone (`POST /v1/analyses` + polling), inchangé et conservé pour
 * la production future.
 *
 * Couche unique (Phase 1) : endpoint, requête, réponse, parsing,
 * validation, timeout, mapping d'erreur, diagnostics — tout centralisé
 * ici. Les écrans (`TcgScanScreen.tsx`) ne font jamais leur propre
 * `fetch`.
 */

/** Timeout client (Phase 4) — légèrement au-dessus de `maxDuration = 30` côté route Vercel (voir route.ts), pour laisser la réponse serveur arriver avant que le client n'abandonne le premier. Valeur centralisée, jamais dupliquée. */
export const TCG_ANALYZE_TIMEOUT_MS = 35_000;

function apiBaseUrl(): string {
  return (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:3000";
}

/** Erreur typée du client — `code` est TOUJOURS un `AnalysisErrorCode` de la taxonomie unique (voir `domain/analysis-errors.ts`), jamais une chaîne libre. */
export class TcgAnalyzeError extends Error {
  constructor(
    public readonly code: AnalysisErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TcgAnalyzeError";
  }
}

async function requireAccessToken(): Promise<string> {
  const token = await getCurrentAccessToken();
  if (!token) throw new TcgAnalyzeError("AUTH_REQUIRED", "Aucune session active — connecte-toi avant de lancer une analyse.");
  return token;
}

export interface AnalyzeTcgCardParams {
  /** URL de stockage Supabase (`analysis-uploads/<userId>/...`) déjà uploadée — voir `tcg-upload-client.ts`. */
  imageUrl?: string;
  /** Saisie manuelle (nom/set/numéro/langue/variante) — chemin 100% déterministe, sans aucun appel IA. */
  providedTcgHints?: TcgCardProvidedHints;
  /**
   * Signal externe optionnel (Phase 5, "cancellation") — permet à
   * l'appelant d'annuler avant le timeout interne (ex. l'utilisateur quitte
   * l'écran). Combiné avec le timeout, jamais un remplacement : quel que
   * soit le signal externe, une requête qui dépasse
   * `TCG_ANALYZE_TIMEOUT_MS` est toujours abandonnée.
   */
  signal?: AbortSignal;
}

export interface AnalyzeTcgCardResponse {
  status: "completed" | "insufficient_data" | "failed";
  result: TcgCardAnalysisResult;
}

/** Forme de la réponse HTTP validée — réutilise `tcgCardAnalysisResultSchema` (`@dealradar/contracts`), jamais une seconde définition du contrat (Phase 2). */
const analyzeResponseSchema = z.object({
  status: z.enum(["completed", "insufficient_data", "failed"]),
  result: tcgCardAnalysisResultSchema,
});

/** Combine un timeout interne fixe avec un signal externe optionnel — abandonne dès que l'un des deux se déclenche. RN (Hermes, RN 0.76) supporte `fetch(..., {signal})`/`AbortController` nativement, aucune dépendance ajoutée. */
function createCombinedAbort(externalSignal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  // Le signal externe peut déjà être abandonné au moment de cet appel (ou
  // s'abandonner avant que l'écouteur ci-dessous n'ait le temps de
  // s'attacher, la fonction appelante étant asynchrone) — vérifié
  // explicitement plutôt que de compter uniquement sur l'événement
  // "abort", qui ne se déclenche jamais pour un signal déjà abandonné.
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", onExternalAbort);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
    didTimeout: () => timedOut,
  };
}

/**
 * Appel synchrone unique — pas de polling : la réponse HTTP contient déjà
 * le résultat final (identifié ou non, prix trouvé ou non).
 *
 * Ne suppose JAMAIS qu'un HTTP 200 est correct (Phase 3) : le corps est
 * toujours validé par `analyzeResponseSchema` avant d'être retourné — une
 * réponse malformée lève `INVALID_ANALYSIS_RESPONSE`, jamais un `result`
 * partiellement typé qui laisserait circuler un `undefined`/`NaN` côté UI.
 */
export async function analyzeTcgCard(params: AnalyzeTcgCardParams): Promise<AnalyzeTcgCardResponse> {
  if (!params.imageUrl && !params.providedTcgHints) {
    throw new TcgAnalyzeError("UNKNOWN_ERROR", "imageUrl ou providedTcgHints requis.");
  }
  const startedAt = Date.now();
  const accessToken = await requireAccessToken();

  const { signal, cleanup, didTimeout } = createCombinedAbort(params.signal, TCG_ANALYZE_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl()}/api/internal/tcg/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ imageUrl: params.imageUrl, providedTcgHints: params.providedTcgHints }),
        signal,
      });
    } catch (error) {
      // `AbortError` recouvre à la fois le timeout interne et une
      // annulation externe — seul le timeout interne doit être présenté
      // comme "REQUEST_TIMEOUT" à l'utilisateur ; une annulation externe
      // volontaire ne doit jamais afficher une erreur (l'appelant a déjà
      // quitté l'écran, voir Phase 5) — distingué via `didTimeout()`.
      if (error instanceof Error && error.name === "AbortError") {
        if (didTimeout()) {
          recordAnalysisError("REQUEST_TIMEOUT", "request", Date.now() - startedAt);
          throw new TcgAnalyzeError("REQUEST_TIMEOUT", "Le serveur a mis trop de temps à répondre.");
        }
        throw error; // annulation externe volontaire — propagée telle quelle, jamais transformée en erreur affichée.
      }
      recordAnalysisError("NETWORK_UNAVAILABLE", "request", Date.now() - startedAt);
      throw new TcgAnalyzeError("NETWORK_UNAVAILABLE", "Impossible de joindre le service — vérifie ta connexion et réessaie.");
    }

    if (!response.ok) {
      const code: AnalysisErrorCode = response.status === 401 ? "AUTH_REQUIRED" : response.status >= 500 ? "BACKEND_UNAVAILABLE" : "UNKNOWN_ERROR";
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      recordAnalysisError(code, "request", Date.now() - startedAt);
      throw new TcgAnalyzeError(code, body?.error?.message ?? mapAnalysisErrorFallbackMessage(code));
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      recordAnalysisError("INVALID_ANALYSIS_RESPONSE", "response_validation", Date.now() - startedAt);
      throw new TcgAnalyzeError("INVALID_ANALYSIS_RESPONSE", "Impossible de lire le résultat de l'analyse.");
    }

    const parsed = analyzeResponseSchema.safeParse(json);
    if (!parsed.success) {
      recordAnalysisError("INVALID_ANALYSIS_RESPONSE", "response_validation", Date.now() - startedAt);
      throw new TcgAnalyzeError("INVALID_ANALYSIS_RESPONSE", "Impossible de lire le résultat de l'analyse.");
    }

    recordAnalysisSuccess(Date.now() - startedAt);
    return parsed.data;
  } finally {
    cleanup();
  }
}

function mapAnalysisErrorFallbackMessage(code: AnalysisErrorCode): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "Session expirée — reconnecte-toi puis réessaie.";
    case "BACKEND_UNAVAILABLE":
      return "Le service est momentanément indisponible.";
    default:
      return "Une erreur est survenue lors de l'analyse.";
  }
}
