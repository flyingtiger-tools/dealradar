import type { SupabaseClient } from "@supabase/supabase-js";
import type { FxRate } from "@dealradar/connectors";
import { fxRateInputSchema } from "./fx-rate-schemas";

export type PersistFxRateOutcome = "inserted" | "unchanged";

export interface PersistFxRateResult {
  outcome: PersistFxRateOutcome;
}

const ON_CONFLICT_COLUMNS = ["base_currency", "quote_currency", "rate_date", "source"] as const;

/**
 * Persiste un `FxRate` déjà récupéré — trace d'audit, jamais une conversion
 * elle-même (voir `packages/connectors/src/fx/convert.ts`, non branché ici).
 * Idempotent sur (source, paire, date) : un taux déjà connu ne se duplique
 * jamais, seul `fetched_at` est rafraîchi.
 */
export async function persistFxRate(supabase: SupabaseClient, rate: FxRate): Promise<PersistFxRateResult> {
  const parsed = fxRateInputSchema.safeParse(rate);
  if (!parsed.success) {
    throw new Error(`Taux de change invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`);
  }
  const v = parsed.data;

  const row = {
    base_currency: v.baseCurrency,
    quote_currency: v.quoteCurrency,
    rate: v.rate,
    rate_date: v.rateDate,
    source: v.source,
    fetched_at: v.fetchedAt,
  };

  let existingQuery = supabase.from("fx_rates").select("id");
  for (const column of ON_CONFLICT_COLUMNS) {
    existingQuery = existingQuery.eq(column, row[column]);
  }
  const { data: existing } = await existingQuery.maybeSingle();

  const { error } = await supabase.from("fx_rates").upsert(row, { onConflict: ON_CONFLICT_COLUMNS.join(",") });
  if (error) {
    throw new Error(`Persistance du taux de change impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }

  return { outcome: existing ? "unchanged" : "inserted" };
}
