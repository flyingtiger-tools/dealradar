import { NextResponse } from "next/server";
import { SOURCE_READINESS_MATRIX, resolveSourceReadiness } from "@dealradar/connectors";
import { getOperatorObservabilitySummary, checkHistoricalEngineAvailability } from "@dealradar/ingestion";
import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { errorResponse } from "./_errors";

/**
 * GET /api/internal/operator/observability — pont read-only entre le
 * mobile (Internal Tools, `EXPO_PUBLIC_INTERNAL_TOOLS`) et les services
 * `@dealradar/ingestion` server-only (LOT "Interactive History + Generic
 * Result UI + Full Cancellation + Pre-Prod Activation Package", sections
 * 4/5) — le mobile ne peut jamais appeler `packages/ingestion` directement
 * (aucun client Supabase service role côté app). Même discipline
 * d'authentification que `/api/internal/tcg/analyze` : jeton Bearer requis,
 * jamais un accès anonyme, même pour un diagnostic en lecture seule.
 *
 * AUCUNE requête SQL arbitraire : deux appels fixes déjà testés
 * (`getOperatorObservabilitySummary`, `checkHistoricalEngineAvailability`),
 * résultat borné (limites déjà internes à ces fonctions + clamp ci-dessous
 * sur `recentRunLimit`), AUCUN champ contenant un secret/une URL
 * authentifiée (garanti par les tests de ces fonctions elles-mêmes,
 * `packages/ingestion`).
 */
export const maxDuration = 30;

const MAX_RECENT_RUN_LIMIT = 50;

/**
 * Préparation par source résolue depuis L'ENVIRONNEMENT DE CE PROCESS
 * (apps/web, Vercel) — PAS celui d'apps/workers (Railway). Une source dont
 * les credentials ne sont configurées QUE côté workers apparaît ici comme
 * `missing_credentials` même si le worker peut réellement l'utiliser :
 * limitation connue, documentée plutôt que silencieuse (voir
 * `docs/market-valuation-quality.md`). Reflète le même modèle que
 * `computeEnvPresenceBySource`/`readinessFor` (`apps/workers/src/ingestion/
 * market-source-factory.ts`), dans un processus différent.
 */
function computeSourceReadiness(): { source: string; readiness: string }[] {
  return SOURCE_READINESS_MATRIX.map((descriptor) => {
    const envPresence: Record<string, boolean> = {};
    for (const envVar of descriptor.requiredEnvVars) envPresence[envVar] = Boolean(process.env[envVar]);
    return { source: descriptor.source, readiness: resolveSourceReadiness(descriptor, envPresence) };
  });
}

export async function GET(request: Request) {
  const auth = await authenticateBearerRequest(request);
  if (!auth) return errorResponse(401, "UNAUTHORIZED", "Jeton d'accès manquant ou invalide.");

  const url = new URL(request.url);
  const recentRunLimitParam = Number(url.searchParams.get("recentRunLimit"));
  const recentRunLimit = Number.isFinite(recentRunLimitParam) && recentRunLimitParam > 0 ? Math.min(MAX_RECENT_RUN_LIMIT, Math.floor(recentRunLimitParam)) : undefined;

  try {
    const db = createServiceRoleClient();
    const [summary, historicalEngine] = await Promise.all([
      getOperatorObservabilitySummary(db, { recentRunLimit, sourceReadiness: computeSourceReadiness() }),
      checkHistoricalEngineAvailability(db),
    ]);
    return NextResponse.json({ summary, historicalEngine });
  } catch (error) {
    console.error("[api/internal/operator/observability] échec inattendu", error);
    return errorResponse(500, "INTERNAL", "Une erreur inattendue est survenue lors de la lecture des diagnostics opérateur.");
  }
}
