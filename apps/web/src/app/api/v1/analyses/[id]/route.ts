import { NextResponse } from "next/server";
import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { errorResponse } from "../_errors";

/**
 * GET /v1/analyses/:id — polling de statut/résultat (ADR 0010). Toujours
 * `404`, jamais `403`, pour l'analyse d'un autre utilisateur : ne jamais
 * confirmer l'existence d'un identifiant qui n'appartient pas à
 * l'appelant (`docs/mobile/threat-model.md` #6/#15).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBearerRequest(request);
  if (!auth) return errorResponse(401, "UNAUTHORIZED", "Jeton d'accès manquant ou invalide.");

  const { id } = await context.params;

  const supabase = createServiceRoleClient();
  const { data: row } = await supabase
    .from("analysis_requests")
    .select("id, user_id, status, result")
    .eq("id", id)
    .maybeSingle();

  if (!row || row.user_id !== auth.userId) {
    return errorResponse(404, "NOT_FOUND", "Analyse introuvable.");
  }

  return NextResponse.json({ id: row.id, status: row.status, result: row.result ?? null });
}
