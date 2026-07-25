-- ============================================================
-- 0003 · Taxonomie généraliste
-- Vertical généraliste : la qualité des comparables dépend
-- d'une taxonomie contrôlée (catégories, marques, attributs).
-- ============================================================

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references public.categories (id) on delete restrict,
  slug       text not null unique,
  name       text not null,
  -- Chemin matérialisé (ex: 'mode.chaussures.baskets') : requêtes d'arbre O(1)
  path       text not null unique,
  depth      int  not null default 0,
  created_at timestamptz not null default now()
);
create index idx_categories_parent on public.categories (parent_id);
create index idx_categories_path on public.categories using btree (path text_pattern_ops);

create table public.brands (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  -- alias connus ('nike', 'NIKE ', 'Niké') → normalisation à l'ingestion
  aliases    text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index idx_brands_aliases on public.brands using gin (aliases);

-- Définitions d'attributs par catégorie (taille, pointure, capacité, état…)
create table public.attribute_definitions (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete cascade,
  key         text not null,               -- 'size', 'condition', 'storage_gb'
  label       text not null,
  value_type  text not null check (value_type in ('text','number','boolean','enum')),
  enum_values text[],
  unique (category_id, key)
);

create type public.item_condition as enum
  ('new', 'like_new', 'very_good', 'good', 'fair', 'for_parts');
