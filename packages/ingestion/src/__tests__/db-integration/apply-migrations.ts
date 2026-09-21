import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";

/**
 * Applique les migrations réelles (`supabase/migrations/*.sql`, non
 * modifiées) sur une base Postgres/Supabase JETABLE — jamais une
 * réécriture séparée du schéma pour les tests, exactement les mêmes
 * fichiers `.sql` que ceux committés (LOT "Real DB Integration...",
 * section 1). Applique TOUTE la séquence 0001→0023 : les migrations 0017+
 * dépendent de fonctions/extensions posées par les migrations antérieures
 * (ex. `touch_updated_at()`, 0002) — appliquer uniquement 0017+ risquerait
 * un échec silencieusement dépendant de l'état préexistant d'une base non
 * neuve. Idempotent PAR PROCESS : si `research_targets` existe déjà,
 * considère le schéma déjà appliqué et ne rejoue rien (permet de réutiliser
 * la même base jetable entre plusieurs exécutions de test sans erreur
 * "relation already exists").
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(HERE, "../../../../../supabase/migrations");

async function tableExists(client: Client, table: string): Promise<boolean> {
  const result = await client.query("select to_regclass($1) as reg", [`public.${table}`]);
  return (result.rows[0] as { reg: string | null } | undefined)?.reg !== null && (result.rows[0] as { reg: string | null } | undefined)?.reg !== undefined;
}

export interface EnsureTestMigrationsResult {
  appliedFiles: string[];
  alreadyApplied: boolean;
}

export async function ensureTestMigrationsApplied(client: Client): Promise<EnsureTestMigrationsResult> {
  const alreadyApplied = await tableExists(client, "research_targets");
  if (alreadyApplied) return { appliedFiles: [], alreadyApplied: true };

  const entries = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const appliedFiles: string[] = [];
  for (const file of entries) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await client.query(sql);
    appliedFiles.push(file);
  }
  return { appliedFiles, alreadyApplied: false };
}

/**
 * Nettoyage SCOPÉ — supprime uniquement les lignes dont `product_key`
 * commence par le préfixe de test fourni, jamais un `TRUNCATE`/`DROP`
 * aveugle qui pourrait affecter des données d'autres tests ou d'un usage
 * manuel de la même base jetable.
 */
export async function cleanupTestRows(client: Client, testKeyPrefix: string): Promise<void> {
  const like = `${testKeyPrefix}%`;
  await client.query("delete from market_snapshot_summaries where product_key like $1", [like]);
  await client.query("delete from listing_lifecycles where product_key like $1", [like]);
  await client.query("delete from market_product_identifiers where product_key like $1", [like]);
  await client.query("delete from market_products where product_key like $1", [like]);
  await client.query("delete from market_observations where product_key like $1", [like]);
  await client.query("delete from research_targets where product_key like $1", [like]);
}
