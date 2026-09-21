import { NextResponse } from "next/server";
import { queryProductHistory } from "@dealradar/ingestion";
import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { errorResponse } from "./_errors";

/**
 * GET /api/internal/operator/product-history?productKey=... — pont
 * read-only entre le mobile (Internal Tools) et `queryProductHistory`
 * (`@dealradar/ingestion`, server-only) (LOT "Interactive History +
 * Generic Result UI + Full Cancellation + Pre-Prod Activation Package",
 * section 10) — prépare le contrat/modèle de vue pour un futur graphique
 * d'historique de prix, SANS construire cet écran ce lot (permission
 * explicite du lot : "not necessarily a full screen yet"). Même
 * discipline d'authentification que `/api/internal/operator/observability` :
 * jeton Bearer requis, jamais un accès anonyme.
 *
 * AUCUNE écriture, AUCUNE recommandation, AUCUNE prédiction de prix futur
 * (garanti par `queryProductHistory`/`computeHistoryIntelligenceV2`
 * elles-mêmes, `@dealradar/core` — jamais recalculé ici). Résultat borné :
 * `recentSummaryLimit` clampé, `lookbackDays` clampé, jamais une requête
 * SQL arbitraire.
 */
export const maxDuration = 30;

const MAX_RECENT_SUMMARY_LIMIT = 50;
const MAX_LOOKBACK_DAYS = 730;

export async function GET(request: Request) {
  const auth = await authenticateBearerRequest(request);
  if (!auth) return errorResponse(401, "UNAUTHORIZED", "Jeton d'accès manquant ou invalide.");

  const url = new URL(request.url);
  const productKey = url.searchParams.get("productKey");
  if (!productKey) return errorResponse(400, "INVALID_REQUEST", "Le paramètre productKey est requis.");

  const recentSummaryLimitParam = Number(url.searchParams.get("recentSummaryLimit"));
  const recentSummaryLimit = Number.isFinite(recentSummaryLimitParam) && recentSummaryLimitParam > 0 ? Math.min(MAX_RECENT_SUMMARY_LIMIT, Math.floor(recentSummaryLimitParam)) : undefined;

  const lookbackDaysParam = Number(url.searchParams.get("lookbackDays"));
  const lookbackDays = Number.isFinite(lookbackDaysParam) && lookbackDaysParam > 0 ? Math.min(MAX_LOOKBACK_DAYS, Math.floor(lookbackDaysParam)) : undefined;

  try {
    const db = createServiceRoleClient();
    const history = await queryProductHistory(db, productKey, { recentSummaryLimit, lookbackDays });
    return NextResponse.json({ history });
  } catch (error) {
    console.error("[api/internal/operator/product-history] échec inattendu", error);
    return errorResponse(500, "INTERNAL", "Une erreur inattendue est survenue lors de la lecture de l'historique produit.");
  }
}
