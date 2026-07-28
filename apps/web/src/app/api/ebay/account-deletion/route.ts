import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { handleAccountDeletionPost } from "./post-handler";

/**
 * eBay Marketplace Account Deletion / Closure Notifications (ADR 0011) —
 * exigence obligatoire du programme développeur eBay avant toute activation
 * d'un keyset Production, indépendante de la qualité du connecteur eBay
 * lui-même (ADR 0008).
 *
 * GET  : défi de vérification envoyé par eBay lors de l'enregistrement de
 *        l'URL dans le Developer Portal.
 * POST : notification réelle — voir `post-handler.ts` pour la logique
 *        complète (validée, dédoublonnée, signature vérifiée, anonymisée).
 *        Séparé de ce fichier car un Route Handler Next.js
 *        (`typedRoutes`) ne peut exporter que les handlers HTTP.
 */

function missingEnvVars(): string[] {
  const required = ["EBAY_VERIFICATION_TOKEN", "EBAY_ACCOUNT_DELETION_ENDPOINT_URL"] as const;
  return required.filter((name) => !process.env[name]);
}

export async function GET(request: Request) {
  const missing = missingEnvVars();
  if (missing.length > 0) {
    console.error("eBay account-deletion : configuration incomplète, défi non traitable —", missing.join(", "));
    return NextResponse.json(
      { error: { code: "MISCONFIGURED", message: "Endpoint non configuré." } },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const challengeCode = url.searchParams.get("challenge_code");
  if (!challengeCode) {
    return NextResponse.json(
      { error: { code: "MISSING_CHALLENGE_CODE", message: "Paramètre challenge_code manquant." } },
      { status: 400 },
    );
  }

  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN!;
  const endpoint = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL!;

  // Ordre exact imposé par eBay (confirmé contre le SDK de référence officiel
  // event-notification-php-sdk, lib/validator.php) : challengeCode +
  // verificationToken + endpoint, concaténés tels quels, SHA-256 en hex.
  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(verificationToken);
  hash.update(endpoint);
  const challengeResponse = hash.digest("hex");

  return NextResponse.json(
    { challengeResponse },
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export async function POST(request: Request) {
  return handleAccountDeletionPost(request);
}
