import { NextResponse } from "next/server";

/** Forme d'erreur commune à tout `/api/v1/*` (ADR 0010, `docs/mobile/api-contract.md`). */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
