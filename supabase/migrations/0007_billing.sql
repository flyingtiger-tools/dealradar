-- ============================================================
-- 0007 · Abonnements, quotas, mesure d'usage (Stripe au Lot 4)
-- Le schéma existe dès maintenant : les contrats sont figés.
-- ============================================================

create table public.plans (
  id            text primary key,                 -- 'free', 'premium_monthly'…
  name          text not null,
  stripe_price_id text unique,
  price_cents   int not null default 0,
  currency      char(3) not null default 'CHF',
  interval      text check (interval in ('month','year')),
  -- Limites déclaratives : {"alerts": 5, "watchlist_items": 50, "api_calls_day": 0}
  limits        jsonb not null default '{}',
  is_active     boolean not null default true
);

insert into public.plans (id, name, price_cents, currency, interval, limits) values
  ('free',    'Découverte', 0,    'CHF', null,    '{"alerts":3,"watchlist_items":20,"portfolio_positions":10}'),
  ('premium', 'Premium',    990,  'CHF', 'month', '{"alerts":100,"watchlist_items":1000,"portfolio_positions":500}');

create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references public.profiles (id) on delete cascade,
  plan_id                text not null references public.plans (id),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text not null default 'active'
                         check (status in ('active','trialing','past_due','canceled')),
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- Mesure d'usage append-only : base du rate limiting et des quotas
create table public.usage_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  metric      text not null,                      -- 'search', 'alert_created', 'api_call'
  quantity    int not null default 1,
  occurred_at timestamptz not null default now()
);
create index idx_usage_user_metric on public.usage_events (user_id, metric, occurred_at desc);
