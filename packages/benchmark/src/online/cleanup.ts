import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureBenchmarkSource } from "./supabase-runner";

export interface CleanupOptions {
  /** Horodatage de début du run — permet de ne purger que le cache IA écrit pendant ce run. */
  runStartedAt: string;
}

export interface CleanupReport {
  listingsDeleted: number;
  cacheRowsDeleted: number;
  /** Non vide si une étape n'a pas pu être confirmée — best-effort documenté, jamais silencieux. */
  warnings: string[];
}

/**
 * Nettoyage best-effort du mode `--online`. Les annonces/médias/observations
 * de prix/résultats Intelligence Core sont supprimés via la contrainte
 * `on delete cascade` déjà en place sur `listings` (migrations 0004/0010) en
 * ne ciblant que la source `benchmark` dédiée — jamais une donnée d'une
 * autre source. Le cache IA (`ai_extraction_cache`) n'est pas rattaché à un
 * `listing_id` : il est purgé par fenêtre temporelle (`created_at >=
 * runStartedAt`), une limite assumée et documentée dans docs/benchmark.md —
 * ne jamais lancer `--online` en parallèle d'un worker de production réel.
 * Appelé depuis un `try/finally` par `cli.ts` : s'exécute même si le run a
 * échoué en cours de route.
 */
export async function cleanupBenchmarkRun(supabase: SupabaseClient, options: CleanupOptions): Promise<CleanupReport> {
  const warnings: string[] = [];
  let listingsDeleted = 0;
  let cacheRowsDeleted = 0;

  try {
    const sourceId = await ensureBenchmarkSource(supabase);
    const { data: listings } = await supabase.from("listings").select("id").eq("source_id", sourceId);
    const ids = ((listings ?? []) as Array<{ id: string }>).map((l) => l.id);
    if (ids.length > 0) {
      const { error } = await supabase.from("listings").delete().in("id", ids);
      if (error) {
        warnings.push(`Suppression des annonces benchmark incomplète : ${error.message}`);
      } else {
        listingsDeleted = ids.length;
      }
    }
  } catch (error) {
    warnings.push(`Nettoyage des annonces benchmark impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`);
  }

  try {
    const { data: cacheRows, error: selectError } = await supabase
      .from("ai_extraction_cache")
      .select("cache_key")
      .gte("created_at", options.runStartedAt);
    if (selectError) {
      warnings.push(`Lecture du cache IA à purger impossible : ${selectError.message}`);
    } else {
      const keys = ((cacheRows ?? []) as Array<{ cache_key: string }>).map((r) => r.cache_key);
      if (keys.length > 0) {
        const { error: deleteError } = await supabase.from("ai_extraction_cache").delete().in("cache_key", keys);
        if (deleteError) {
          warnings.push(`Suppression du cache IA benchmark incomplète : ${deleteError.message}`);
        } else {
          cacheRowsDeleted = keys.length;
        }
      }
    }
  } catch (error) {
    warnings.push(`Nettoyage du cache IA benchmark impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`);
  }

  return { listingsDeleted, cacheRowsDeleted, warnings };
}
