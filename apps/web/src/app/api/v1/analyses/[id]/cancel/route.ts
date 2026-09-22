import { NextResponse } from "next/server";
import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { errorResponse } from "../../_errors";

/**
 * POST /v1/analyses/:id/cancel — annulation INTERACTIVE (LOT "Product
 * History UX + Source Health + Interactive Cancellation + Beta Readiness",
 * section 6/7). Le chemin interactif ne peut pas être annulé directement
 * par un abandon de requête HTTP (la file `analysis.process` continue
 * indépendamment du client) — cette route appelle la fonction RPC
 * `request_analysis_cancellation` (migration 0026), qui pose
 * `cancel_requested_at` UNIQUEMENT si la requête appartient à l'appelant ET
 * reste dans un état non terminal (`pending`/`processing`). Le worker
 * (`apps/workers/src/jobs/process-analysis.ts`) consulte ensuite lui-même
 * cette colonne AVANT ses étapes coûteuses, jamais une annulation
 * "devinée" ici.
 *
 * Toujours `404`, jamais `403`, pour l'analyse d'un autre utilisateur —
 * même discipline que `GET /v1/analyses/:id` (menace #6/#15).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBearerRequest(request);
  if (!auth) return errorResponse(401, "UNAUTHORIZED", "Jeton d'accès manquant ou invalide.");

  const { id } = await context.params;
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase.from("analysis_requests").select("id, user_id, status").eq("id", id).maybeSingle();
  if (!row || row.user_id !== auth.userId) {
    return errorResponse(404, "NOT_FOUND", "Analyse introuvable.");
  }

  // La RPC elle-même vérifie à nouveau la propriété (`auth.uid()` côté
  // Postgres) — cette lecture préalable ne sert qu'à distinguer 404
  // (inexistante/pas la mienne) de 409 (déjà terminale), jamais une
  // vérification suffisante à elle seule.
  const { data: cancelled, error } = await supabase.rpc("request_analysis_cancellation", { p_analysis_request_id: id });
  if (error) {
    console.error("[api/v1/analyses/:id/cancel] échec inattendu", error);
    return errorResponse(500, "INTERNAL", "Une erreur inattendue est survenue lors de l'annulation.");
  }

  if (!cancelled) {
    return errorResponse(409, "ALREADY_TERMINAL", "Cette analyse est déjà terminée — l'annulation n'a aucun effet.");
  }

  return NextResponse.json({ id, cancelRequested: true });
}
