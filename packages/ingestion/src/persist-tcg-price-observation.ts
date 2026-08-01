import type { SupabaseClient } from "@supabase/supabase-js";
import type { TcgCrossMatchResult } from "@dealradar/connectors";
import { tcgPriceObservationInputSchema } from "./tcg-price-schemas";

export type PersistTcgPriceOutcome = "inserted" | "unchanged" | "refused";

export interface PersistTcgPriceResult {
  outcome: PersistTcgPriceOutcome;
  reason?: string;
}

/**
 * Colonnes de la clé d'unicité (migration 0014) — identiques à celles de
 * l'upsert : un prix inchangé pour la même carte/variante/langue/gradation/
 * devise/région fusionne en place, un prix différent crée une nouvelle
 * ligne d'historique.
 */
const IDENTITY_COLUMNS = [
  "source",
  "external_product_id",
  "catalog_source",
  "catalog_external_id",
  "currency",
  "region",
  "price_type",
  "condition",
  "grading_company",
  "grade",
  "variant",
  "language",
] as const;

const ON_CONFLICT_COLUMNS = [...IDENTITY_COLUMNS, "amount_cents"].join(",");

/**
 * Persiste un `TcgCrossMatchResult` comme observation de prix exploitable —
 * uniquement si `outcome === "exact_match"` (LOT 3 : la seule issue jamais
 * destinée à alimenter quoi que ce soit derrière elle). `probable_match`,
 * `ambiguous` et `no_match` sont refusés ici, jamais persistés comme prix,
 * même partiellement. Aucune conversion de devise, aucune décision
 * BUY/REVIEW/PASS modifiée par cette fonction.
 */
export async function persistTcgPriceObservation(
  supabase: SupabaseClient,
  categorySlug: string,
  result: TcgCrossMatchResult,
): Promise<PersistTcgPriceResult> {
  if (result.outcome !== "exact_match") {
    return {
      outcome: "refused",
      reason: `Correspondance "${result.outcome}" — seul un exact_match peut être persisté comme prix exploitable.`,
    };
  }
  if (result.priceObservations.length !== 1) {
    return { outcome: "refused", reason: "Un exact_match doit porter exactement une observation de prix." };
  }

  const observation = result.priceObservations[0]!;
  const identity = result.identity;

  const parsed = tcgPriceObservationInputSchema.safeParse({
    categorySlug,
    source: observation.source,
    externalProductId: observation.externalProductId,
    catalogSource: identity.catalogSource,
    catalogExternalId: identity.catalogExternalId,
    game: identity.game,
    name: identity.cardName,
    setName: identity.setName,
    cardNumber: identity.cardNumber,
    // Les champs de la variante réellement tarifée (côté pricing) priment sur
    // les indices catalogue : un exact_match garantit qu'ils concordent déjà.
    variant: observation.variant ?? identity.variant,
    language: observation.language ?? identity.language,
    productKind: identity.productKind,
    condition: observation.condition,
    gradingCompany: observation.gradingCompany ?? identity.gradingCompany,
    grade: observation.grade ?? identity.grade,
    amountCents: observation.amountCents,
    currency: observation.currency,
    priceType: observation.priceType,
    region: observation.region,
    provenance: observation.provenance,
    confidence: result.confidence,
    warnings: result.warnings,
    sourceUpdatedAt: observation.updatedAt,
  });

  if (!parsed.success) {
    throw new Error(`Observation de prix TCG invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`);
  }
  const v = parsed.data;

  const nowIso = new Date().toISOString();
  const row = {
    source: v.source,
    external_product_id: v.externalProductId,
    catalog_source: v.catalogSource,
    catalog_external_id: v.catalogExternalId,
    category_slug: v.categorySlug,
    game: v.game,
    name: v.name,
    set_name: v.setName,
    card_number: v.cardNumber,
    variant: v.variant ?? "",
    language: v.language ?? "",
    product_kind: v.productKind,
    condition: v.condition ?? "",
    grading_company: v.gradingCompany ?? "",
    grade: v.grade ?? "",
    amount_cents: v.amountCents,
    currency: v.currency,
    price_type: v.priceType,
    region: v.region,
    provenance: v.provenance,
    confidence: v.confidence,
    warnings: v.warnings,
    match_outcome: "exact_match" as const,
    raw_payload: observation,
    observed_at: nowIso,
    source_updated_at: v.sourceUpdatedAt,
  };

  let existingQuery = supabase.from("tcg_price_observations").select("id").eq("amount_cents", row.amount_cents);
  for (const column of IDENTITY_COLUMNS) {
    existingQuery = existingQuery.eq(column, row[column]);
  }
  const { data: existing } = await existingQuery.maybeSingle();

  const { error } = await supabase
    .from("tcg_price_observations")
    .upsert(row, { onConflict: ON_CONFLICT_COLUMNS });
  if (error) {
    throw new Error(`Persistance de l'observation de prix TCG impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }

  return { outcome: existing ? "unchanged" : "inserted" };
}
