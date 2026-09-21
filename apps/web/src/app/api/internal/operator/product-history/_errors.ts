import { NextResponse } from "next/server";

/** Même forme d'erreur que `/api/internal/operator/observability` — dupliqué ici (fichier local, ~10 lignes) plutôt qu'un import cross-route, même convention déjà établie par l'existant. */
export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
