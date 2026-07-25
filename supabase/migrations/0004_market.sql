-- ============================================================
-- 0004 · Données de marché
-- Sources, annonces, médias, historique de prix.
-- Écritures : service role (workers) uniquement — cf. 0009.
-- ============================================================

create table public.sources (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,          -- 'leboncoin', 'vinted', 'ebay_fr'
  name          text not null,
  base_url      text not null,
  country       char(2) not null,
  is_active     boolean not null default false,
  -- Configuration adapter (cadence, catégories couvertes) — pas de secrets ici
  adapter_config jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create type public.listing_status as enum
  ('active', 'sold', 'expired', 'removed', 'flagged');

create table public.listings (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.sources (id),
  external_id    text not null,                -- id chez la source
  url            text not null,
  title          text not null,
  description    text,
  price_cents    bigint not null check (price_cents >= 0),
  currency       char(3) not null default 'EUR',
  status         public.listing_status not null default 'active',
  condition      public.item_condition,
  category_id    uuid references public.categories (id),
  brand_id       uuid references public.brands (id),
  -- Attributs normalisés extraits à l'ingestion : {"size":"42","color":"noir"}
  attributes     jsonb not null default '{}',
  seller_external_id text,
  location_text  text,
  location_geo   point,
  -- Embedding sémantique (titre+description+attributs) pour les comparables
  embedding      vector(768),
  -- Recherche plein texte (ADR 0005)
  search_tsv     tsvector generated always as
    (setweight(to_tsvector('french', coalesce(title, '')), 'A') ||
     setweight(to_tsvector('french', coalesce(description, '')), 'B')) stored,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  sold_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (source_id, external_id)
);
create index idx_listings_search on public.listings using gin (search_tsv);
create index idx_listings_trgm on public.listings using gin (title gin_trgm_ops);
create index idx_listings_category on public.listings (category_id, status);
create index idx_listings_brand on public.listings (brand_id);
create index idx_listings_attributes on public.listings using gin (attributes);
create index idx_listings_embedding on public.listings
  using hnsw (embedding vector_cosine_ops);

create trigger trg_listings_touch before update on public.listings
  for each row execute function public.touch_updated_at();

create table public.listing_media (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  kind       text not null default 'image' check (kind in ('image','video')),
  source_url text not null,
  storage_path text,                            -- copie Supabase Storage si archivée
  position   int not null default 0,
  -- Sorties futures OCR / Vision AI (authenticité, défauts, texte visible)
  ocr_text   text,
  vision_labels jsonb,
  created_at timestamptz not null default now()
);
create index idx_media_listing on public.listing_media (listing_id);

-- Historique de prix : append-only, une ligne par observation
create table public.price_observations (
  id          bigint generated always as identity primary key,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  price_cents bigint not null,
  currency    char(3) not null,
  status      public.listing_status not null,
  observed_at timestamptz not null default now()
);
create index idx_price_obs_listing on public.price_observations (listing_id, observed_at desc);

-- Agrégats de marché par (catégorie, marque, état) : base des tendances
create table public.market_aggregates (
  id           bigint generated always as identity primary key,
  category_id  uuid not null references public.categories (id),
  brand_id     uuid references public.brands (id),
  condition    public.item_condition,
  period_start date not null,
  period_end   date not null,
  median_price_cents bigint,
  p25_price_cents    bigint,
  p75_price_cents    bigint,
  sample_size  int not null,
  avg_days_to_sale numeric(6,1),
  computed_at  timestamptz not null default now(),
  unique (category_id, brand_id, condition, period_start, period_end)
);
