import type { FakeSupabase } from "./fake-supabase";

/**
 * Simule fidèlement `claim_research_target`/`release_research_target`
 * (migration 0021) contre l'état en mémoire d'un `FakeSupabase`, pour les
 * tests unitaires/d'intégration qui n'ont pas de vraie Postgres. JS étant
 * mono-thread, ceci ne teste PAS l'atomicité réelle `FOR UPDATE SKIP
 * LOCKED` (garantie uniquement par Postgres) — mais reproduit exactement
 * la logique de sélection/tri/bail pour vérifier le CONTRAT côté appelant :
 * deux appels séquentiels ne réclament jamais deux fois la même cible tant
 * qu'un bail actif existe, un bail expiré redevient réclamable, etc.
 */
export function installSimulatedResearchTargetLeaseRpcs(supabase: FakeSupabase, now: () => Date = () => new Date()): void {
  supabase.registerRpc("claim_research_target", (params) => {
    const leaseOwner = params.p_lease_owner as string;
    const leaseDurationSeconds = params.p_lease_duration_seconds as number;
    const limit = (params.p_limit as number | undefined) ?? 1;
    const nowMs = now().getTime();

    const rows = supabase.table("research_targets") as Array<Record<string, unknown>>;
    const due = rows
      .filter((row) => {
        if (row.enabled !== true) return false;
        const nextRefreshAt = row.next_refresh_at as string | null;
        if (nextRefreshAt !== null && new Date(nextRefreshAt).getTime() > nowMs) return false;
        const claimedBy = row.claimed_by as string | null;
        if (claimedBy === null || claimedBy === undefined) return true;
        const leaseExpiresAt = row.lease_expires_at as string | null;
        return leaseExpiresAt !== null && new Date(leaseExpiresAt).getTime() < nowMs;
      })
      .sort((a, b) => {
        const pa = a.priority as number;
        const pb = b.priority as number;
        if (pa !== pb) return pb - pa;
        const ta = a.next_refresh_at ? new Date(a.next_refresh_at as string).getTime() : 0;
        const tb = b.next_refresh_at ? new Date(b.next_refresh_at as string).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return (a.id as number) - (b.id as number);
      })
      .slice(0, limit);

    const nowIso = new Date(nowMs).toISOString();
    for (const row of due) {
      row.claimed_by = leaseOwner;
      row.claimed_at = nowIso;
      row.lease_expires_at = new Date(nowMs + leaseDurationSeconds * 1000).toISOString();
      row.attempt_count = ((row.attempt_count as number) ?? 0) + 1;
      row.updated_at = nowIso;
    }

    return { data: due.map((row) => ({ ...row })), error: null };
  });

  supabase.registerRpc("release_research_target", (params) => {
    const targetId = params.p_target_id as number;
    const leaseOwner = params.p_lease_owner as string;
    const rows = supabase.table("research_targets") as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === targetId);
    if (!row || row.claimed_by !== leaseOwner) return { data: false, error: null };

    row.claimed_by = null;
    row.claimed_at = null;
    row.lease_expires_at = null;
    row.updated_at = new Date(now().getTime()).toISOString();
    return { data: true, error: null };
  });
}
