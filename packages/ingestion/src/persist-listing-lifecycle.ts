import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketObservation } from "@dealradar/connectors";
import { reconcileListingLifecycles, type ListingLifecycleState, type ListingObservationEvent } from "@dealradar/core";

/**
 * Intégration persistante du moteur PUR `reconcileListingLifecycles`
 * (`@dealradar/core`, LOT "Historical Data Engine", non modifié) —
 * `listing_lifecycles` (migration 0022, LOT "Close the Refresh Loop",
 * section 9). Charge l'état précédent SCOPÉ à `product_key` (jamais un
 * scan complet de table), réconcilie avec les observations de CE cycle,
 * upserte le résultat. Idempotent : rejouer le même cycle logique
 * (mêmes `observedThisCycle`/`asOf`) produit le même état persisté.
 */
export interface ReconcileAndPersistListingLifecyclesInput {
  supabase: SupabaseClient;
  productKey: string;
  observations: readonly MarketObservation[];
  asOf: string;
  /** Nombre d'heures sans être revue avant qu'une annonce active soit marquée disparue — jamais déduit d'un seul cycle manqué par défaut (voir `markListingNotObservedIfDue`). */
  disappearanceRuleHours: number;
}

export interface ReconcileAndPersistListingLifecyclesResult {
  states: ListingLifecycleState[];
  upsertedCount: number;
}

interface RawListingLifecycleRow {
  source: string;
  source_item_id: string;
  product_key: string | null;
  first_seen_at: string;
  last_seen_at: string;
  observed_count: number;
  currently_seen: boolean;
  disappeared_at: string | null;
  confirmed_sold_at: string | null;
}

function listingKeyFor(source: string, sourceItemId: string): string {
  return `${source}:${sourceItemId}`;
}

function rowToState(row: RawListingLifecycleRow): ListingLifecycleState {
  return {
    listingKey: listingKeyFor(row.source, row.source_item_id),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    observedCount: row.observed_count,
    currentlySeen: row.currently_seen,
    disappearedAt: row.disappeared_at,
    confirmedSoldAt: row.confirmed_sold_at,
  };
}

export async function reconcileAndPersistListingLifecycles(
  input: ReconcileAndPersistListingLifecyclesInput,
): Promise<ReconcileAndPersistListingLifecyclesResult> {
  const { data: previousRows, error: readError } = await input.supabase
    .from("listing_lifecycles")
    .select("*")
    .eq("product_key", input.productKey);
  if (readError) {
    throw new Error(`Lecture du cycle de vie d'annonces impossible : ${(readError as { message?: string }).message ?? "erreur inconnue"}`);
  }

  const previousStates = ((previousRows as RawListingLifecycleRow[] | null) ?? []).map(rowToState);

  const observedThisCycle = new Map<string, ListingObservationEvent>();
  for (const observation of input.observations) {
    const key = listingKeyFor(observation.source, observation.sourceItemId);
    // Un même (source, sourceItemId) ne devrait apparaître qu'une fois par cycle après dédoublonnage canonique en amont ; en cas de doublon résiduel, la dernière observation gagne — jamais une exception, jamais un événement de vente écrasé par un événement ultérieur qui n'en confirme pas une (voir `recordListingObservation`).
    const existing = observedThisCycle.get(key);
    observedThisCycle.set(key, {
      observedAt: observation.observedAt,
      confirmedSoldAt: existing?.confirmedSoldAt ?? observation.soldAt ?? null,
    });
  }

  const states = reconcileListingLifecycles({
    previousStates,
    observedThisCycle,
    asOf: input.asOf,
    disappearanceRuleHours: input.disappearanceRuleHours,
  });

  if (states.length === 0) return { states, upsertedCount: 0 };

  const rows = states.map((state) => {
    const [source, ...rest] = state.listingKey.split(":");
    return {
      source,
      source_item_id: rest.join(":"),
      product_key: input.productKey,
      first_seen_at: state.firstSeenAt,
      last_seen_at: state.lastSeenAt,
      observed_count: state.observedCount,
      currently_seen: state.currentlySeen,
      disappeared_at: state.disappearedAt,
      confirmed_sold_at: state.confirmedSoldAt,
    };
  });

  const { error: writeError } = await input.supabase.from("listing_lifecycles").upsert(rows, { onConflict: "source,source_item_id" });
  if (writeError) {
    throw new Error(`Persistance du cycle de vie d'annonces impossible : ${(writeError as { message?: string }).message ?? "erreur inconnue"}`);
  }

  return { states, upsertedCount: rows.length };
}
