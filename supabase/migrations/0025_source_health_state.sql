-- ============================================================
-- 0025 · État de santé PAR SOURCE (LOT "Product History UX + Source Health
-- + Interactive Cancellation + Beta Readiness", section 4)
--
-- Persiste `SourceHealthState` (`packages/connectors/src/market-
-- intelligence/source-health-tracker.ts`) — une ligne PAR SOURCE, jamais
-- un historique complet (retention-friendly, même discipline que
-- `market_refresh_runs`, migration 0024). Uniquement des compteurs/
-- horodatages/classes de raison SÛRES — JAMAIS un secret, JAMAIS une URL
-- de requête, JAMAIS un payload brut.
--
-- Un abandon opérateur/utilisateur (`aborted_count`) N'EST JAMAIS compté
-- comme un échec de santé — voir `consecutive_failures`/`last_failure_at`,
-- qui restent inchangés par un abandon (règle absolue du lot, section 4).
--
-- Écritures : service role uniquement (workers/web), même politique que
-- les autres tables de ce lot et des lots précédents.
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017 à 0024).
-- ============================================================

create table public.source_health_state (
  source                       text primary key,
  enabled                      boolean not null default true,
  last_success_at              timestamptz,
  last_failure_at              timestamptz,
  last_failure_reason_class    text,
  -- Fenêtre glissante des 20 dernières latences (ms) — voir MAX_LATENCY_SAMPLES, `source-health-tracker.ts`.
  recent_latencies_ms          jsonb not null default '[]'::jsonb,
  requests_used                integer not null default 0,
  total_estimated_cost_usd     numeric not null default 0,
  -- Compteur de récupération GRADUELLE (+1 échec/timeout, -1 succès, jamais sous 0, INCHANGÉ par un abandon) — alimente classifySourceHealth (healthy/degraded/unhealthy).
  consecutive_failures         integer not null default 0,
  -- Abandons opérateur/utilisateur — JAMAIS comptés comme un échec.
  aborted_count                integer not null default 0,
  timeout_count                integer not null default 0,
  observations_returned_total  integer not null default 0,
  updated_at                   timestamptz not null default now()
);
comment on table public.source_health_state is 'État de santé PAR SOURCE (LOT "Product History UX + Source Health + Interactive Cancellation + Beta Readiness", section 4) — une ligne par source, jamais un historique complet ; un abandon opérateur/utilisateur ne réduit jamais la santé.';

alter table public.source_health_state enable row level security;
create policy "source_health_state: lecture" on public.source_health_state
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement.
