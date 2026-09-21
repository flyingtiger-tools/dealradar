/**
 * Modèle typé d'une ligne `research_targets` (migrations 0020/0021) —
 * point de vérité UNIQUE pour la forme snake_case (DB) <-> camelCase (TS),
 * partagé par toutes les fonctions de lecture/réclamation de ce paquet
 * (LOT "Close the Refresh Loop", sections 1/2).
 */
export interface ResearchTargetRow {
  id: number;
  productKey: string;
  reason: "user_scan" | "watchlist" | "high_activity" | "manual_seed";
  priority: number;
  desiredCurrency: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
  nextRefreshAt: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  lastError: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

/** Ligne brute (snake_case) telle que renvoyée par Supabase/postgrest — jamais exposée telle quelle en dehors de ce module. */
export interface RawResearchTargetRow {
  id: number;
  product_key: string;
  reason: string;
  priority: number;
  desired_currency: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_refreshed_at: string | null;
  next_refresh_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  last_error: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
}

export function toResearchTargetRow(raw: RawResearchTargetRow): ResearchTargetRow {
  return {
    id: raw.id,
    productKey: raw.product_key,
    reason: raw.reason as ResearchTargetRow["reason"],
    priority: raw.priority,
    desiredCurrency: raw.desired_currency,
    enabled: raw.enabled,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    lastRefreshedAt: raw.last_refreshed_at,
    nextRefreshAt: raw.next_refresh_at,
    claimedBy: raw.claimed_by,
    claimedAt: raw.claimed_at,
    leaseExpiresAt: raw.lease_expires_at,
    attemptCount: raw.attempt_count,
    lastError: raw.last_error,
    lastSuccessAt: raw.last_success_at,
    consecutiveFailures: raw.consecutive_failures,
  };
}
