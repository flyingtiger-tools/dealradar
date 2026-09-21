-- ============================================================
-- 0024 · Audit durable des runs/cibles de rafraîchissement (LOT "Real DB
-- Integration + Exact Budget Enforcement + Runtime Observability",
-- sections 6/7)
--
-- Persiste UNIQUEMENT des métadonnées SÛRES : identifiants, horodatages,
-- compteurs, noms de source, classes de raison — JAMAIS un secret, JAMAIS
-- une URL porteuse de credential, JAMAIS un payload brut complet
-- (retention-friendly, instruction explicite du lot). Un échec de
-- persistance d'audit ne doit JAMAIS interrompre le lot de rafraîchissement
-- lui-même (voir `packages/ingestion/src/persist-refresh-run-audit.ts`,
-- qui isole cette écriture dans un try/catch dédié).
--
-- Écritures : service role uniquement (workers), même politique que les
-- autres tables de ce lot et des lots précédents.
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017 à 0023).
-- ============================================================

create table public.market_refresh_runs (
  id                          bigint generated always as identity primary key,
  -- Identifiant STABLE généré par l'appelant (ex. uuid) — jamais réutilisé, permet de relier les lignes `market_refresh_run_targets` sans dépendre de `id` (utile si l'appelant a besoin de connaître la clé AVANT l'insertion, ex. journalisation applicative).
  run_key                     text not null unique,
  -- Identifiant libre du bailleur (id de process workers) — jamais un secret, même politique que `research_targets.claimed_by` (migration 0021).
  lease_owner                 text not null,
  started_at                  timestamptz not null,
  finished_at                 timestamptz,

  considered                  integer not null default 0,
  claimed                     integer not null default 0,
  succeeded                   integer not null default 0,
  failed                      integer not null default 0,
  observations_persisted      integer not null default 0,

  -- Compteurs PAR RAISON (ex. {"succeeded": 3, "identity_too_weak": 1, "fx_unavailable": 2}) — bag ouvert, jamais un schéma figé qui devrait être migré à chaque nouvelle classe de raison.
  target_counts_by_outcome    jsonb not null default '{}'::jsonb,
  -- Compteurs par statut de source (ex. {"success": 5, "error": 2}) — jamais un nom de source associé à une valeur de credential.
  source_counts_by_status     jsonb not null default '{}'::jsonb,
  error_class_counts          jsonb not null default '{}'::jsonb,

  elapsed_ms                  integer,
  timed_out                   boolean not null default false,
  budget_exhausted            boolean not null default false,

  created_at                  timestamptz not null default now()
);
comment on table public.market_refresh_runs is 'Audit durable PAR RUN de rafraîchissement (LOT "Real DB Integration...", section 6) — métadonnées sûres uniquement, jamais un secret ni un payload brut complet.';

create index idx_market_refresh_runs_started on public.market_refresh_runs (started_at desc);

alter table public.market_refresh_runs enable row level security;
create policy "market_refresh_runs: lecture" on public.market_refresh_runs
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement.

-- ------------------------------------------------------------
-- Audit PAR CIBLE (section 7) — une ligne par cible traitée dans un run,
-- retention-friendly : uniquement des compteurs/noms/classes, jamais un
-- dump d'observation brute.
-- ------------------------------------------------------------
create table public.market_refresh_run_targets (
  id                       bigint generated always as identity primary key,
  run_id                   bigint not null references public.market_refresh_runs (id) on delete cascade,
  -- Référence LOGIQUE (jamais de FK stricte, même raisonnement que les autres tables de ce lot) vers `research_targets.id`/`market_products.product_key`.
  research_target_id       bigint,
  product_key              text not null,

  claimed_at               timestamptz,
  started_at               timestamptz,
  finished_at              timestamptz,

  outcome                  text not null check (outcome in ('succeeded', 'failed')),
  failure_reason           text,

  -- Noms de source uniquement (ex. ["bricklink", "keepa"]) — jamais une URL de requête ni une valeur de credential.
  selected_sources         jsonb not null default '[]'::jsonb,
  -- {"ricardo": "Verrouillé par politique (restricted).", ...} — raison PAR SOURCE exclue, jamais une valeur de credential.
  skipped_source_reasons   jsonb not null default '{}'::jsonb,

  observations_returned    integer not null default 0,
  observations_persisted   integer not null default 0,
  fx_skipped_count         integer not null default 0,
  identity_conflict_count  integer not null default 0,

  next_refresh_at          timestamptz,
  -- Classe d'erreur SÛRE (ex. "transient_source_outage") — jamais un message brut pouvant contenir une URL/valeur sensible (voir packages/core/src/scheduling/refresh-retry-policy.ts pour la même discipline).
  safe_error_class         text,

  created_at               timestamptz not null default now()
);
comment on table public.market_refresh_run_targets is 'Audit durable PAR CIBLE dans un run de rafraîchissement (LOT "Real DB Integration...", section 7) — retention-friendly, jamais un payload brut complet.';

create index idx_market_refresh_run_targets_run on public.market_refresh_run_targets (run_id);
create index idx_market_refresh_run_targets_product on public.market_refresh_run_targets (product_key);

alter table public.market_refresh_run_targets enable row level security;
create policy "market_refresh_run_targets: lecture" on public.market_refresh_run_targets
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement.
