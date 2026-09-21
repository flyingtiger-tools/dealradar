import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalProductIdentity } from "@dealradar/core";
import { canonicalProductIdentityInputSchema } from "./product-identity-schemas";

/**
 * Persiste une `CanonicalProductIdentity` (`@dealradar/core`) dans
 * `market_products`/`market_product_identifiers` (migration 0019, LOT
 * "Historical Data Engine", section 3) — jamais appliquée à la Production
 * par ce lot. Idempotent : la même affirmation (produit, champ, valeur,
 * source) ne se duplique jamais (contrainte `unique` de la table).
 *
 * Ne résout JAMAIS un conflit elle-même — persiste `identity.fields` et
 * `identity.aliases` TELS QUELS, y compris quand `identity.conflicts` est
 * non vide (plusieurs lignes `market_product_identifiers` pour le même
 * champ avec des valeurs différentes restent représentables en base,
 * exactement comme en mémoire — voir `merge-identity-evidence.ts`).
 */
export interface PersistCanonicalProductIdentityResult {
  productKey: string;
  identifierRowsUpserted: number;
}

const SOFT_PRODUCT_COLUMNS = ["brand", "model", "variant", "color", "generation", "region", "language", "styleCode", "sku", "normalizedConditionTarget"] as const;

function toSnakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export async function persistCanonicalProductIdentity(
  supabase: SupabaseClient,
  identity: CanonicalProductIdentity,
): Promise<PersistCanonicalProductIdentityResult> {
  const parsed = canonicalProductIdentityInputSchema.safeParse(identity);
  if (!parsed.success) {
    throw new Error(`Identité produit canonique invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`);
  }

  const productRow: Record<string, unknown> = {
    product_key: identity.productKey,
    category_slug: identity.categorySlug,
    last_seen_at: new Date().toISOString(),
  };
  for (const field of SOFT_PRODUCT_COLUMNS) {
    const claim = identity.fields[field];
    if (claim) productRow[toSnakeCase(field)] = claim.value;
  }

  const { error: productError } = await supabase.from("market_products").upsert(productRow, { onConflict: "product_key" });
  if (productError) {
    throw new Error(`Persistance de l'identité produit impossible : ${(productError as { message?: string }).message ?? "erreur inconnue"}`);
  }

  const identifierRows: Record<string, unknown>[] = [];
  for (const [field, claim] of Object.entries(identity.fields)) {
    if (!claim) continue;
    identifierRows.push({
      product_key: identity.productKey,
      field,
      value: claim.value,
      source: claim.source,
      confidence: claim.confidence,
      observed_at: claim.observedAt,
    });
  }
  for (const alias of identity.aliases) {
    identifierRows.push({
      product_key: identity.productKey,
      field: alias.field,
      value: alias.value,
      source: alias.source,
      confidence: alias.confidence,
      observed_at: alias.observedAt,
    });
  }

  if (identifierRows.length > 0) {
    const { error: identifiersError } = await supabase
      .from("market_product_identifiers")
      .upsert(identifierRows, { onConflict: "product_key,field,value,source" });
    if (identifiersError) {
      throw new Error(`Persistance des identifiants produit impossible : ${(identifiersError as { message?: string }).message ?? "erreur inconnue"}`);
    }
  }

  return { productKey: identity.productKey, identifierRowsUpserted: identifierRows.length };
}
