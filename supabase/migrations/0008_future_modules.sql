-- ============================================================
-- 0008 · Emplacements réservés : ML, marketplace, publication,
-- analyse des ventes. Non développés — contrats de données figés.
-- ============================================================

-- ── Machine Learning ─────────────────────────────────────────
create table public.ml_models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                      -- 'price_estimator'
  version     text not null,
  task        text not null,                      -- 'price_estimation','fraud_detection'
  metrics     jsonb not null default '{}',        -- MAE, AUC… à l'entraînement
  is_active   boolean not null default false,
  trained_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (name, version)
);

-- Shadow scoring (ADR 0006) : prédictions comparées aux moteurs heuristiques
create table public.ml_predictions (
  id          bigint generated always as identity primary key,
  model_id    uuid not null references public.ml_models (id),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  output      jsonb not null,
  predicted_at timestamptz not null default now()
);
create index idx_ml_pred_listing on public.ml_predictions (listing_id, predicted_at desc);

-- ── Analyse des ventes (temps de vente, saisonnalité) ────────
create table public.sale_events (
  id            bigint generated always as identity primary key,
  listing_id    uuid not null references public.listings (id) on delete cascade,
  sold_price_cents bigint,
  days_on_market   int,
  detected_at   timestamptz not null default now()
);
create index idx_sale_events_listing on public.sale_events (listing_id);

-- ── Publication automatique (croisement futur avec le portfolio) ─
create table public.publication_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  position_id uuid not null references public.portfolio_positions (id) on delete cascade,
  target_source_id uuid not null references public.sources (id),
  payload     jsonb not null default '{}',        -- annonce générée
  status      text not null default 'draft'
              check (status in ('draft','queued','published','failed')),
  published_url text,
  created_at  timestamptz not null default now()
);

-- ── Marketplace future (transactions internes) ───────────────
create table public.marketplace_offers (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  position_id uuid references public.portfolio_positions (id),
  title       text not null,
  price_cents bigint not null,
  currency    char(3) not null default 'CHF',
  status      text not null default 'draft'
              check (status in ('draft','listed','reserved','sold','withdrawn')),
  created_at  timestamptz not null default now()
);
