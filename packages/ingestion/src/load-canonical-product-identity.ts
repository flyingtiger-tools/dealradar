import type { SupabaseClient } from "@supabase/supabase-js";
import { createCanonicalProductIdentity, mergeIdentityEvidence, ALL_IDENTITY_FIELDS, type CanonicalProductIdentity, type IdentityEvidence, type IdentityField } from "@dealradar/core";

const STRUCTURED_FIELD_SET = new Set<string>(ALL_IDENTITY_FIELDS);

interface RawIdentifierRow {
  field: string;
  value: string;
  source: string;
  confidence: number;
  observed_at: string;
}

/**
 * Recharge une `CanonicalProductIdentity` déjà persistée (LOT "Close the
 * Refresh Loop", section 3 — "load canonical identity" avant de planifier
 * un rafraîchissement). Plutôt que de dupliquer la logique de fusion,
 * REJOUE chaque ligne `market_product_identifiers` (triée par
 * `observed_at` croissant) à travers `mergeIdentityEvidence`
 * (`@dealradar/core`), déjà pur et testé — garantit que l'état rechargé
 * est EXACTEMENT celui qu'aurait produit la même séquence de preuves
 * fusionnée en direct, y compris les conflits non résolus.
 *
 * Renvoie `null` si aucun produit connu sous cette clé — jamais une
 * identité vide fabriquée, l'appelant doit alors traiter le cas "identité
 * inconnue" explicitement.
 */
export async function loadCanonicalProductIdentity(supabase: SupabaseClient, productKey: string): Promise<CanonicalProductIdentity | null> {
  const { data: productRow, error: productError } = await supabase.from("market_products").select("*").eq("product_key", productKey).maybeSingle();
  if (productError) {
    throw new Error(`Lecture de l'identité produit impossible : ${(productError as { message?: string }).message ?? "erreur inconnue"}`);
  }
  if (!productRow) return null;

  const { data: identifierRows, error: identifiersError } = await supabase
    .from("market_product_identifiers")
    .select("*")
    .eq("product_key", productKey)
    .order("observed_at", { ascending: true });
  if (identifiersError) {
    throw new Error(`Lecture des identifiants produit impossible : ${(identifiersError as { message?: string }).message ?? "erreur inconnue"}`);
  }

  let identity = createCanonicalProductIdentity((productRow as { category_slug: string }).category_slug, productKey);
  for (const row of (identifierRows as RawIdentifierRow[] | null) ?? []) {
    const isStructured = STRUCTURED_FIELD_SET.has(row.field);
    const evidence: IdentityEvidence = {
      source: row.source,
      confidence: row.confidence,
      observedAt: row.observed_at,
      fields: isStructured ? { [row.field as IdentityField]: row.value } : {},
      aliases: isStructured ? [] : [{ field: row.field, value: row.value }],
    };
    identity = mergeIdentityEvidence(identity, evidence).identity;
  }

  return identity;
}
