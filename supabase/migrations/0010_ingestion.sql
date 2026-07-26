-- ============================================================
-- 0010 · Data Engine — ingestion, orchestration Intelligence Core
-- Connecteur eBay (Lot 4). Écritures : service role (workers) uniquement.
-- ============================================================

-- Statut de traitement applicatif d'une annonce — distinct de listing_status
-- (qui décrit l'état marché : active/sold/expired/...). Celui-ci décrit où
-- en est l'annonce dans notre propre pipeline.
create type public.processing_status as enum
  ('collected', 'normalized', 'analyzed', 'insufficient_data', 'failed');

alter table public.listings
  add column processing_status public.processing_status not null default 'collected',
  -- Payload source minimisé (liste blanche, cf. packages/connectors/src/ebay/redact.ts) —
  -- jamais le JSON brut complet, jamais de secret/jeton (ADR 0008).
  add column raw_payload jsonb,
  add column raw_payload_collected_at timestamptz;

-- Purge manuelle du payload minimisé au-delà d'une rétention donnée.
-- Durée configurable à l'appel : select public.purge_raw_payloads('30 days'::interval);
create or replace function public.purge_raw_payloads(older_than interval)
returns void language sql as $$
  update public.listings
  set raw_payload = null, raw_payload_collected_at = null
  where raw_payload_collected_at is not null
    and raw_payload_collected_at < now() - older_than;
$$;

-- Un run par (source, catégorie, requête) exécutée manuellement ou via la file.
create table public.ingestion_runs (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.sources (id),
  category_slug text not null,
  query_text    text not null,
  status        text not null default 'running' check (status in ('running', 'completed', 'failed')),
  fetched       int not null default 0,
  inserted      int not null default 0,
  updated       int not null default 0,
  skipped       int not null default 0,
  failed        int not null default 0,
  last_offset   int,
  has_more      boolean not null default false,
  error_message text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index idx_ingestion_runs_source on public.ingestion_runs (source_id, started_at desc);
-- Anti double-déclenchement : un seul run actif à la fois pour une même
-- combinaison (garantie DB, pas seulement applicative — évite toute race condition).
create unique index ux_ingestion_runs_active on public.ingestion_runs (source_id, category_slug, query_text)
  where status = 'running';

create table public.ingestion_errors (
  id               bigint generated always as identity primary key,
  ingestion_run_id uuid not null references public.ingestion_runs (id) on delete cascade,
  external_id      text,
  http_status      int,
  message          text not null,
  occurred_at      timestamptz not null default now()
);
create index idx_ingestion_errors_run on public.ingestion_errors (ingestion_run_id, occurred_at desc);

-- Résultat d'un passage dans Intelligence Core. Table neuve, distincte de
-- `scores` : le vocabulaire de décision du Lot 3 (BUY/REVIEW/PASS/
-- INSUFFICIENT_DATA) est incompatible avec l'enum `verdict` existant
-- (buy/wait/sell), conçu pour un moteur différent (ADR 0006 vs ADR 0007).
create table public.intelligence_results (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references public.listings (id) on delete cascade,
  decision         text not null check (decision in ('BUY', 'REVIEW', 'PASS', 'INSUFFICIENT_DATA')),
  deal_score       int,
  confidence_score int not null,
  liquidity_score  int not null,
  why_panel        jsonb not null default '{}',
  computed_at      timestamptz not null default now()
);
create index idx_intelligence_results_listing on public.intelligence_results (listing_id, computed_at desc);

-- ── Rôle Postgres dédié à l'enqueue depuis apps/web ──────────
-- Aucun accès au schéma public (pas de grant sur listings/profiles/etc.) :
-- seul le schéma pgboss lui est ouvert. Créé NOLOGIN — un mot de passe ne
-- doit jamais figurer dans un fichier versionné ; voir ADR 0008 pour la
-- procédure d'activation manuelle (ALTER ROLE ... WITH LOGIN PASSWORD via
-- le SQL Editor Supabase, jamais committée) et le risque documenté tant
-- que ce rôle n'est pas activé.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dealradar_enqueue') then
    create role dealradar_enqueue nologin;
  end if;
end
$$;

-- pg-boss crée lui-même son schéma au premier démarrage des workers ; le
-- créer ici par avance est sans risque (idempotent) et permet d'accorder
-- les privilèges avant même le premier run.
create schema if not exists pgboss;
grant connect on database postgres to dealradar_enqueue;
grant usage on schema pgboss to dealradar_enqueue;
grant select, insert on all tables in schema pgboss to dealradar_enqueue;
alter default privileges in schema pgboss grant select, insert on tables to dealradar_enqueue;

-- ── RLS ───────────────────────────────────────────────────────
alter table public.ingestion_runs enable row level security;
create policy "ingestion_runs: lecture admin" on public.ingestion_runs
  for select using (public.is_admin());

alter table public.ingestion_errors enable row level security;
create policy "ingestion_errors: lecture admin" on public.ingestion_errors
  for select using (public.is_admin());

alter table public.intelligence_results enable row level security;
create policy "intelligence_results: lecture" on public.intelligence_results
  for select to authenticated using (true);

-- ── Seed : source eBay ────────────────────────────────────────
insert into public.sources (slug, name, base_url, country, is_active)
values ('ebay', 'eBay', 'https://www.ebay.com', 'CH', true)
on conflict (slug) do nothing;
