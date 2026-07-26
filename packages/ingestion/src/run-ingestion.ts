import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceConnector } from "@dealradar/connectors";
import { normalizedListingSchema } from "./schemas";
import { persistListing } from "./persist-listing";

export interface RunIngestionInput {
  supabase: SupabaseClient;
  connector: MarketplaceConnector;
  sourceSlug: string;
  categorySlug: string;
  q: string;
  /** Garde-fou pour ne jamais paginer indéfiniment. */
  maxPages?: number;
  pageSize?: number;
}

export interface RunIngestionSummary {
  runId: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  /** IDs des annonces persistées avec succès (insérées ou mises à jour) — pour chaîner analyzeListing(). */
  listingIds: string[];
}

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PAGE_SIZE = 50;

/**
 * Pagine via `connector.search()`, valide chaque annonce, persiste, et
 * journalise. Idempotent (persistListing dédoublonne) ; une erreur sur un
 * item n'interrompt jamais le traitement du reste de la page. Refuse de
 * démarrer si un run identique (source+catégorie+requête) est déjà en
 * cours — vérification applicative en complément de l'index unique partiel
 * `ux_ingestion_runs_active` (garantie DB contre les races réelles).
 */
export async function runIngestion(input: RunIngestionInput): Promise<RunIngestionSummary> {
  const { supabase, connector, sourceSlug, categorySlug, q } = input;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .select("id")
    .eq("slug", sourceSlug)
    .single();
  const sourceRow = source as { id: string } | null;
  if (sourceError || !sourceRow) {
    throw new Error(`Source inconnue : "${sourceSlug}".`);
  }
  const sourceId = sourceRow.id;

  const { data: activeRun } = await supabase
    .from("ingestion_runs")
    .select("id")
    .eq("source_id", sourceId)
    .eq("category_slug", categorySlug)
    .eq("query_text", q)
    .eq("status", "running")
    .maybeSingle();
  if (activeRun) {
    throw new Error(
      `Un run est déjà en cours pour "${sourceSlug}" / "${categorySlug}" / "${q}" — attends qu'il se termine avant d'en relancer un identique.`,
    );
  }

  const { data: run, error: runError } = await supabase
    .from("ingestion_runs")
    .insert({ source_id: sourceId, category_slug: categorySlug, query_text: q, status: "running" })
    .select("id")
    .single();
  const runRow = run as { id: string } | null;
  if (runError || !runRow) {
    throw new Error(
      `Impossible de démarrer le run d'ingestion (peut-être déjà en cours) : ${(runError as { message?: string } | null)?.message ?? "erreur inconnue"}`,
    );
  }
  const runId = runRow.id;

  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let offset = 0;
  let hasMore = true;
  let page = 0;
  const listingIds: string[] = [];

  try {
    while (hasMore && page < maxPages) {
      const searchResult = await connector.search({ q, categorySlug, offset, limit: pageSize });
      fetched += searchResult.listings.length;

      for (const candidate of searchResult.listings) {
        const parsed = normalizedListingSchema.safeParse(candidate);
        if (!parsed.success) {
          failed += 1;
          await logIngestionError(
            supabase,
            runId,
            candidate.meta.externalId,
            null,
            `Annonce invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`,
          );
          continue;
        }
        try {
          const result = await persistListing(supabase, sourceId, parsed.data);
          listingIds.push(result.listingId);
          if (result.outcome === "inserted") inserted += 1;
          else if (result.outcome === "updated") updated += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
          await logIngestionError(
            supabase,
            runId,
            parsed.data.meta.externalId,
            null,
            error instanceof Error ? error.message : "erreur de persistance inconnue",
          );
        }
      }

      hasMore = searchResult.hasMore;
      offset += searchResult.listings.length || pageSize;
      page += 1;

      await supabase
        .from("ingestion_runs")
        .update({ fetched, inserted, updated, skipped, failed, last_offset: offset, has_more: hasMore })
        .eq("id", runId);
    }

    await supabase
      .from("ingestion_runs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        fetched,
        inserted,
        updated,
        skipped,
        failed,
        has_more: hasMore,
      })
      .eq("id", runId);
  } catch (error) {
    await supabase
      .from("ingestion_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : "erreur inconnue",
      })
      .eq("id", runId);
    throw error;
  }

  return { runId, fetched, inserted, updated, skipped, failed, listingIds };
}

async function logIngestionError(
  supabase: SupabaseClient,
  runId: string,
  externalId: string | null,
  httpStatus: number | null,
  message: string,
): Promise<void> {
  await supabase
    .from("ingestion_errors")
    .insert({ ingestion_run_id: runId, external_id: externalId, http_status: httpStatus, message });
}
