import { NextResponse } from "next/server";
import { z } from "zod";
import { tcgCardProvidedHintsSchema } from "@dealradar/contracts";
import { processTcgCardAnalysis } from "@dealradar/ingestion";
import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildTcgAiExtractionConfig } from "@/lib/tcg-ai-provider-config";
import { buildTcgPipelineConnectorsFromEnv } from "@/lib/tcg-connector-config";
import { errorResponse } from "./_errors";

/**
 * POST /api/internal/tcg/analyze — pipeline TCG synchrone (lot "journée
 * autonome", Priorité 7/8) : photo → extraction IA → corroboration
 * catalogue → pricing → résultat, en UNE requête, sans file d'attente ni
 * worker long-running. Distinct de POST /v1/analyses (asynchrone, création
 * de ligne + `pg-boss` + polling) — celui-ci reste inchangé pour la
 * production future ; cet endpoint est réservé au Scanner Pokémon internal
 * (`EXPO_PUBLIC_INTERNAL_TOOLS`) tant que le worker Railway n'est pas
 * redéployé.
 *
 * N'écrit AUCUNE ligne `analysis_requests` — endpoint interne, sans
 * historique/RLS à gérer, juste `extraction → corroboration → pricing →
 * JSON`. La photo (si fournie) est supprimée du stockage après traitement,
 * succès ou échec (voir `processTcgCardAnalysis`, mécanisme `finally`
 * inchangé).
 *
 * `maxDuration` conservateur : les limites exactes du plan Vercel Hobby
 * varient selon la source consultée (10s à 60s) — 30s reste sous les deux,
 * à reconfirmer sur la documentation Vercel avant toute mise en production
 * réelle plutôt que supposé.
 */
export const maxDuration = 30;

const MAX_BODY_BYTES = 20_000;

const requestSchema = z
  .object({
    imageUrl: z.string().url().optional(),
    providedTcgHints: tcgCardProvidedHintsSchema.nullable().optional(),
  })
  .refine((body) => Boolean(body.imageUrl) || Boolean(body.providedTcgHints), {
    message: "imageUrl ou providedTcgHints requis.",
  });

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

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_REQUEST", parsed.error.issues.map((issue) => issue.message).join(" "));
  }
  const body = parsed.data;

  // Même règle que POST /v1/analyses (ADR 0010, menace SSRF) : une
  // référence d'image doit pointer dans le stockage propriétaire de
  // l'utilisateur authentifié, jamais une URL externe arbitraire.
  if (body.imageUrl) {
    const ownPrefix = `/analysis-uploads/${auth.userId}/`;
    if (!body.imageUrl.includes(ownPrefix)) {
      return errorResponse(422, "UNSUPPORTED_IMAGE", "Référence d'image hors du stockage propriétaire.");
    }
  }

  const db = createServiceRoleClient();
  const aiConfig = buildTcgAiExtractionConfig(db);
  const connectors = buildTcgPipelineConnectorsFromEnv();

  const { status, result } = await processTcgCardAnalysis(
    db,
    {
      id: crypto.randomUUID(),
      imageReferences: body.imageUrl ? [{ url: body.imageUrl }] : [],
      providedTcgHints: body.providedTcgHints ?? null,
    },
    { extractionOptions: aiConfig?.extractionOptions, connectors },
  );

  return NextResponse.json({ status, result });
}
