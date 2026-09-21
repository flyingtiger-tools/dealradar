import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Vérification SÛRE, en LECTURE SEULE, de la disponibilité des tables
 * requises par le moteur d'historique/rafraîchissement (LOT "Data Quality
 * Calibration + Operator Observability + Mobile Market Insight Contract",
 * section 9 — alimente le contrat de diagnostics internes). `limit(0)`
 * borne chaque requête à ZÉRO ligne retournée (aucune donnée réelle
 * jamais lue) — sert uniquement à détecter si la relation existe (une
 * table absente renvoie une erreur Postgrest "relation does not exist",
 * capturée ici, jamais remontée comme un crash). Aucune écriture, aucune
 * migration appliquée par cette fonction elle-même.
 *
 * DÉCISION DE PORTÉE (section 9) : l'écran de diagnostics internes lui-même
 * (mobile, zone Internal Tools) reste VOLONTAIREMENT DIFFÉRÉ à un lot futur
 * — seul le contrat API/requête (cette fonction + `getOperatorObservability
 * Summary`, `./operator-observability.ts`) est livré ici, conformément à la
 * permission explicite du lot ("If mobile internal tooling is too invasive,
 * provide the API/query contract + tests and defer the screen"). Aucun
 * écran mobile ne consomme ces fonctions aujourd'hui.
 */
const REQUIRED_TABLES = [
  "market_observations",
  "market_products",
  "market_product_identifiers",
  "research_targets",
  "listing_lifecycles",
  "market_snapshot_summaries",
  "market_refresh_runs",
  "market_refresh_run_targets",
] as const;

export interface HistoricalEngineAvailability {
  /** `true` UNIQUEMENT si TOUTES les tables requises existent — une seule manquante suffit à retourner `false`. */
  allTablesAvailable: boolean;
  tables: { table: string; available: boolean }[];
}

export async function checkHistoricalEngineAvailability(supabase: SupabaseClient): Promise<HistoricalEngineAvailability> {
  const tables = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      const { error } = await supabase.from(table).select("*").limit(0);
      return { table, available: !error };
    }),
  );
  return { allTablesAvailable: tables.every((t) => t.available), tables };
}
