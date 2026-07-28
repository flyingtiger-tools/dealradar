import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountDeletionNotificationSchema } from "./notification-schema";
import { notificationDedupStore, type NotificationDedupStore } from "./dedup-store";
import { verifyEbaySignature } from "./signature";
import { anonymizeEbaySellerData } from "./data-deletion";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Logique du POST extraite de `route.ts` : un Route Handler Next.js
 * (`typedRoutes`) ne peut exporter que les handlers HTTP et quelques champs
 * réservés (`config`, `dynamic`, ...) — tout autre export nommé (comme
 * `handleAccountDeletionPost` ci-dessous) fait échouer la vérification de
 * types générée par Next. D'où ce module séparé, importé par `route.ts`.
 *
 * ── Ordre de traitement (round 4) et pourquoi ─────────────────────────
 * 1. Configuration : `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` obligatoires
 *    dans **tout** environnement déployé (plus de bypass hors production —
 *    voir ADR 0011, « Signature obligatoire dans tout environnement »).
 *    `EBAY_ENVIRONMENT` ne sert plus qu'à choisir l'hôte API eBay
 *    sandbox/production, jamais à désactiver la vérification.
 * 2. Signature `X-EBAY-SIGNATURE` vérifiée contre les **octets bruts**,
 *    **avant tout `JSON.parse`** — un corps dont la signature est absente
 *    ou invalide n'est jamais interprété, jamais journalisé au-delà de la
 *    raison d'échec structurée. Seule une injection explicite de
 *    dépendance (`deps.verifySignature`) permet de contourner ce contrôle,
 *    et uniquement dans les tests unitaires.
 * 3. Dédoublonnage (best-effort) **après** la vérification de signature —
 *    dans l'ordre inverse, un attaquant non authentifié pourrait "empoisonner"
 *    le store en envoyant un `notificationId` réel avec une signature
 *    invalide, faisant ensuite ignorer à tort la notification légitime.
 * 4. Anonymisation : `markSeen` n'est appelé **qu'après confirmation du
 *    succès** — un échec (erreur Supabase, timeout, exception) ne marque
 *    rien, une nouvelle tentative peut donc réussir normalement. C'est
 *    l'idempotence de `anonymizeEbaySellerData` qui garantit la sûreté
 *    d'une telle nouvelle tentative, pas la déduplication elle-même.
 *
 * Un échec de traitement (signature exceptée, qui a son propre code)
 * retourne désormais un statut d'erreur explicite (400/500/503) au lieu
 * d'un `200` optimiste — un `200` n'est renvoyé que lorsque le traitement
 * a réellement réussi, ou lorsqu'il n'y avait légitimement rien à faire
 * (doublon, sujet non corrélable, topic/schéma non pris en charge).
 */

interface AccountDeletionEnv {
  EBAY_ENVIRONMENT?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
}

/**
 * Dépendances injectables du traitement POST — permet aux tests d'injecter
 * un vérificateur de signature mocké (`verifySignature`), une source de
 * données factice (`getServiceRoleClient`) et un environnement contrôlé
 * (`env`), sans dépendre d'un mock de module. `POST` (route.ts) utilise les
 * implémentations réelles. **C'est le seul point de contournement de la
 * signature** — le code runtime réel (`defaultDeps`) ne l'utilise jamais.
 */
export interface AccountDeletionPostDeps {
  verifySignature: typeof verifyEbaySignature;
  anonymize: typeof anonymizeEbaySellerData;
  dedupStore: NotificationDedupStore;
  getServiceRoleClient: () => SupabaseClient;
  env: AccountDeletionEnv;
}

export const defaultDeps: AccountDeletionPostDeps = {
  verifySignature: verifyEbaySignature,
  anonymize: anonymizeEbaySellerData,
  dedupStore: notificationDedupStore,
  getServiceRoleClient: createServiceRoleClient,
  // `process.env` n'expose qu'une signature d'index à TypeScript — cast
  // explicite légitime, l'index signature garantit `string | undefined`
  // pour ces trois clés comme pour n'importe quelle autre.
  env: process.env as AccountDeletionEnv,
};

function errorResponse(status: number, code: string, message: string): Response {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function handleAccountDeletionPost(
  request: Request,
  deps: AccountDeletionPostDeps = defaultDeps,
): Promise<Response> {
  const clientId = deps.env.EBAY_CLIENT_ID;
  const clientSecret = deps.env.EBAY_CLIENT_SECRET;

  // Obligatoire dans TOUT environnement déployé — EBAY_ENVIRONMENT ne fait
  // que choisir l'hôte API (sandbox/production) pour la vérification,
  // jamais un interrupteur de sécurité. Échec fermé avant toute lecture du
  // corps : un endpoint mal configuré ne doit jamais traiter quoi que ce
  // soit.
  if (!clientId || !clientSecret) {
    console.error(
      "eBay account-deletion : EBAY_CLIENT_ID/EBAY_CLIENT_SECRET requis (vérification de signature obligatoire dans tout environnement) — configuration incomplète, aucun traitement",
    );
    return errorResponse(500, "MISCONFIGURED", "Vérification de signature obligatoire ; configuration incomplète.");
  }

  const rawBody = await request.text();
  const environment = deps.env.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox";
  const signatureHeader = request.headers.get("x-ebay-signature");

  const outcome = await deps.verifySignature(rawBody, signatureHeader, { clientId, clientSecret, environment });
  if (!outcome.valid) {
    // Jamais de kid/signature/username/userId/eiasToken/EBAY_CLIENT_* dans
    // ce log — le corps n'a même pas encore été interprété comme JSON à ce
    // stade, uniquement la raison structurée de l'échec.
    console.error("eBay account-deletion : signature invalide, traitement bloqué —", { reason: outcome.reason });
    return errorResponse(412, "SIGNATURE_INVALID", "Signature X-EBAY-SIGNATURE invalide ou absente.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    console.warn("eBay account-deletion : corps JSON syntaxiquement invalide (signature pourtant valide)");
    return errorResponse(400, "INVALID_JSON", "Corps de requête JSON syntaxiquement invalide.");
  }

  const parsed = accountDeletionNotificationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    // Topic/version de schéma non pris en charge : ce n'est ni une erreur
    // temporaire ni quelque chose qu'une nouvelle tentative résoudrait —
    // acquittement 200 délibéré pour éviter des retries indéfinis d'eBay
    // sur une notification que cet endpoint ne traitera jamais (mauvais
    // routage ou schéma déprécié), voir ADR 0011.
    console.warn(
      "eBay account-deletion : payload rejeté (topic/schéma non pris en charge), acquitté sans traitement —",
      parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; "),
    );
    return NextResponse.json({ acknowledged: true }, { status: 200 });
  }

  const notification = parsed.data;
  const notificationId = notification.notification.notificationId;

  if (deps.dedupStore.hasSeen(notificationId)) {
    console.log("eBay account-deletion : notification dupliquée (dédup best-effort), ignorée —", { notificationId });
    return NextResponse.json({ acknowledged: true }, { status: 200 });
  }

  try {
    const supabase = deps.getServiceRoleClient();
    const result = await deps.anonymize(supabase, {
      username: notification.notification.data.username,
      userId: notification.notification.data.userId,
    });

    // Marqué "vu" uniquement après succès confirmé — un échec ci-dessous
    // (catch) ne marque rien, une nouvelle tentative peut donc réussir.
    deps.dedupStore.markSeen(notificationId);

    if (!result.correlationAttempted) {
      // Code neutre, jamais d'identifiant — voir ADR 0011 : seul
      // `username` est aujourd'hui corrélable (Browse API n'expose aucun
      // identifiant immuable), une notification qui n'en fournit pas ne
      // peut pas être rattachée automatiquement à des données persistées.
      console.log("eBay account-deletion : DELETION_SUBJECT_NOT_CORRELATED —", { notificationId });
    } else {
      console.log("eBay account-deletion : notification traitée —", {
        notificationId,
        eventDate: notification.notification.eventDate,
        listingsAnonymized: result.listingsAnonymized,
      });
    }

    return NextResponse.json({ acknowledged: true }, { status: 200 });
  } catch (error) {
    // Erreur interne/temporaire (Supabase, timeout, réseau) avant
    // confirmation du succès : ne JAMAIS acquitter par 200 — eBay doit
    // retenter, et l'anonymisation étant idempotente, une nouvelle
    // tentative est sûre et ne provoque aucun dommage ni double effet.
    console.error("eBay account-deletion : échec du traitement (anonymisation), notification NON acquittée —", {
      notificationId,
      error: error instanceof Error ? error.message : "erreur inconnue",
    });
    return errorResponse(503, "PROCESSING_FAILED", "Échec temporaire du traitement ; nouvelle tentative attendue.");
  }
}
