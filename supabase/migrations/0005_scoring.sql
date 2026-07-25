-- ============================================================
-- 0005 · Comparables & Scores (ADR 0004, 0006)
-- Chaque score est auditable : moteur versionné + comparables datés.
-- ============================================================

-- Ensemble de comparables matérialisé pour une annonce à un instant T
create table public.comparable_sets (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings (id) on delete cascade,
  method       text not null default 'hnsw_v1',   -- stratégie de sélection
  params       jsonb not null default '{}',        -- filtres appliqués (audit)
  computed_at  timestamptz not null default now()
);
create index idx_compsets_listing on public.comparable_sets (listing_id, computed_at desc);

create table public.comparable_members (
  comparable_set_id uuid not null references public.comparable_sets (id) on delete cascade,
  listing_id        uuid not null references public.listings (id) on delete cascade,
  similarity        real not null check (similarity between 0 and 1),
  price_cents       bigint not null,               -- prix figé au moment du calcul
  primary key (comparable_set_id, listing_id)
);

create type public.verdict as enum ('buy', 'wait', 'sell');

-- Scores : une ligne par (annonce, type, version) — jamais écrasés
create table public.scores (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.listings (id) on delete cascade,
  score_type        text not null check (score_type in ('deal','risk','trust')),
  value             numeric(5,2) not null check (value between 0 and 100),
  verdict           public.verdict,                -- rempli pour deal
  engine_version    text not null,                 -- ex: 'deal_v1'
  comparable_set_id uuid references public.comparable_sets (id),
  explanation       jsonb not null default '{}',   -- facteurs : transparence produit
  computed_at       timestamptz not null default now()
);
create index idx_scores_listing on public.scores (listing_id, score_type, computed_at desc);

-- Vue : dernier score de chaque type par annonce
create view public.latest_scores as
select distinct on (listing_id, score_type)
  listing_id, score_type, value, verdict, engine_version, comparable_set_id, computed_at
from public.scores
order by listing_id, score_type, computed_at desc;
