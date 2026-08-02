import { NextResponse } from "next/server";
import { QUEUES, analysisRequestSchema } from "@dealradar/core";
import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { enqueueJob } from "@/lib/pgboss";
import { errorResponse } from "./_errors";

/**
 * POST /v1/analyses — contrat universel d'analyse (ADR 0010,
 * `docs/mobile/api-contract.md`). Ne fait jamais l'extraction/le scoring
 * ici : valide, limite, dé-duplique, enfile — le job `analysis.process`
 * (`apps/workers/src/jobs/process-analysis.ts`) fait tout le travail.
 */

const RATE_LIMIT_BUCKET = "analysis_create";
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_PER_WINDOW = 10;
/** Corps JSON seulement — les images sont déjà uploadées vers Storage par le client avant cet appel. */
const MAX_BODY_BYTES = 50_000;
const UNIQUE_VIOLATION = "23505";

export async function POST(request: Request) {
  const auth = await authenticateBearerRequest(request);
  if (!auth) return errorResponse(401, "UNAUTHORIZED", "Jeton d'accès manquant ou invalide.");

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE", "Corps de requête trop volumineux.");
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Corps de requête JSON invalide.");
  }

  const parsed = analysisRequestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_REQUEST", parsed.error.issues.map((issue) => issue.message).join(" "));
  }
  const body = parsed.data;

  // Chaque référence d'image doit pointer dans le stockage propriétaire de
  // l'utilisateur authentifié — jamais une URL externe arbitraire. Aucune
  // requête sortante n'est jamais déclenchée depuis cette route (menace SSRF,
  // `docs/mobile/threat-model.md` #12).
  const ownPrefix = `/analysis-uploads/${auth.userId}/`;
  for (const image of body.imageReferences) {
    if (!image.url.includes(ownPrefix)) {
      return errorResponse(422, "UNSUPPORTED_IMAGE", "Référence d'image hors du stockage propriétaire.");
    }
  }

  const supabase = createServiceRoleClient();

  const { data: allowed, error: rateLimitError } = await supabase.rpc("check_and_increment_rate_limit", {
    p_user_id: auth.userId,
    p_bucket: RATE_LIMIT_BUCKET,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    p_max_count: RATE_LIMIT_MAX_PER_WINDOW,
  });
  if (rateLimitError) {
    return errorResponse(500, "INTERNAL", "Vérification du rate limit impossible.");
  }
  if (!allowed) {
    return errorResponse(429, "RATE_LIMITED", "Trop de requêtes d'analyse. Réessayez plus tard.", {
      "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS),
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("analysis_requests")
    .insert({
      user_id: auth.userId,
      client_request_id: body.clientRequestId,
      source_type: body.sourceType,
      source_platform: body.sourcePlatform,
      shared_url: body.sharedUrl,
      title: body.title,
      description: body.description,
      category_slug: body.categorySlug,
      purchase_price: body.purchasePrice,
      currency: body.currency,
      image_references: body.imageReferences,
      consent_version: body.consentVersion,
      provided_tcg_hints: body.providedTcgHints,
    })
    .select("id, status")
    .maybeSingle();

  let analysisRequest: { id: string; status: string };

  if (insertError) {
    if (insertError.code !== UNIQUE_VIOLATION) {
      return errorResponse(500, "INTERNAL", "Écriture de la requête d'analyse impossible.");
    }
    // Idempotence : une réémission réseau ne crée jamais une seconde analyse
    // ni un second appel IA — on relit simplement la ligne déjà créée.
    const { data: existing, error: fetchError } = await supabase
      .from("analysis_requests")
      .select("id, status")
      .eq("user_id", auth.userId)
      .eq("client_request_id", body.clientRequestId)
      .single();
    if (fetchError || !existing) {
      return errorResponse(500, "INTERNAL", "Requête déjà en conflit, introuvable à la relecture.");
    }
    analysisRequest = existing;
  } else if (!inserted) {
    return errorResponse(500, "INTERNAL", "Écriture de la requête d'analyse impossible.");
  } else {
    analysisRequest = inserted;
    try {
      await enqueueJob(QUEUES.processAnalysis, { analysisRequestId: inserted.id });
    } catch (error) {
      return errorResponse(500, "INTERNAL", error instanceof Error ? error.message : "Impossible d'enfiler l'analyse.");
    }
  }

  return NextResponse.json({ id: analysisRequest.id, status: analysisRequest.status }, { status: 202 });
}
