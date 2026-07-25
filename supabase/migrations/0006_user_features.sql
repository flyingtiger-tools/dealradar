-- ============================================================
-- 0006 · Fonctionnalités utilisateur
-- Watchlists, alertes, portfolio, recherches sauvegardées, notifications.
-- ============================================================

create table public.watchlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_watchlists_user on public.watchlists (user_id);
create trigger trg_watchlists_touch before update on public.watchlists
  for each row execute function public.touch_updated_at();

create table public.watchlist_items (
  watchlist_id uuid not null references public.watchlists (id) on delete cascade,
  listing_id   uuid not null references public.listings (id) on delete cascade,
  note         text,
  added_at     timestamptz not null default now(),
  primary key (watchlist_id, listing_id)
);

create table public.saved_searches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  -- Requête structurée : {"q":"vélo cargo","category":"...","max_price_cents":...}
  query      jsonb not null,
  created_at timestamptz not null default now()
);
create index idx_saved_searches_user on public.saved_searches (user_id);

create type public.alert_kind as enum
  ('price_below', 'new_match', 'verdict_change', 'back_in_market');

create table public.alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          public.alert_kind not null,
  -- Cible : une annonce précise OU une recherche sauvegardée
  listing_id    uuid references public.listings (id) on delete cascade,
  saved_search_id uuid references public.saved_searches (id) on delete cascade,
  params        jsonb not null default '{}',      -- ex: {"threshold_cents": 5000}
  is_active     boolean not null default true,
  last_fired_at timestamptz,
  created_at    timestamptz not null default now(),
  check (listing_id is not null or saved_search_id is not null)
);
create index idx_alerts_user on public.alerts (user_id) where is_active;

-- Portfolio : positions détenues par l'utilisateur (« quand vendre »)
create table public.portfolio_positions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  title             text not null,
  category_id       uuid references public.categories (id),
  brand_id          uuid references public.brands (id),
  condition         public.item_condition,
  acquired_at       date,
  acquired_price_cents bigint,
  currency          char(3) not null default 'CHF',
  -- Lien optionnel vers l'annonce d'origine si achetée via DealRadar
  source_listing_id uuid references public.listings (id),
  status            text not null default 'held'
                    check (status in ('held','listed','sold')),
  sold_at           date,
  sold_price_cents  bigint,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_portfolio_user on public.portfolio_positions (user_id, status);
create trigger trg_portfolio_touch before update on public.portfolio_positions
  for each row execute function public.touch_updated_at();

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,                       -- 'alert', 'system', 'billing'
  title      text not null,
  body       text,
  data       jsonb not null default '{}',         -- deep-link, ids
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on public.notifications (user_id, created_at desc);
