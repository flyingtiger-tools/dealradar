-- ============================================================
-- 0023 · Résumés d'instantané compacts pour analytique historique (LOT
-- "Close the Refresh Loop + Operational Hardening + Activation Harness",
-- section 10)
--
-- Une ligne PAR CYCLE d'instantané pour un produit — jamais recalculée à
-- la volée à partir de `market_observations` pour un usage analytique
-- répété (coûteux), jamais un remplacement de la donnée source (les
-- observations brutes restent la seule source de vérité, ce résumé n'est
-- qu'une projection). AUCUNE recommandation utilisateur (BUY/PASS/REVIEW)
-- n'est jamais persistée ici — instruction explicite du lot ("no user
-- recommendation required" = ne doit jamais en porter une).
--
-- Écritures : service role uniquement (workers), même politique que les
-- autres tables de ce lot et des lots précédents.
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017 à 0022).
-- ============================================================

create table public.market_snapshot_summaries (
  id                    bigint generated always as identity primary key,
  -- Référence LOGIQUE vers `market_products.product_key` — même
  -- raisonnement que les autres tables de ce lot (jamais de FK stricte).
  product_key           text not null,
  -- Horodatage LOGIQUE du cycle (généralement `asOf` de l'instantané, pas
  -- forcément `created_at`) — voir `cycle_key` ci-dessous pour
  -- l'idempotence, distincte de cet horodatage descriptif.
  cycle_at              timestamptz not null,
  -- Clé d'idempotence du cycle (ex. `${productKey}:${asOf}`) — un même
  -- cycle logique rejoué ne duplique jamais la ligne, seulement une mise
  -- à jour en place (upsert).
  cycle_key             text not null unique,

  currency              char(3) not null,
  low_cents             bigint,
  fair_cents            bigint,
  high_cents            bigint,
  confidence            integer check (confidence is null or (confidence >= 0 and confidence <= 100)),

  observation_count     integer not null default 0,
  source_count          integer not null default 0,
  strongest_tier        text check (strongest_tier is null or strongest_tier in ('A', 'B', 'C', 'D', 'E')),
  -- 0-100, voir `MarketCoverageReport`/diagnostics de couverture — jamais un montant réel.
  coverage_score        integer check (coverage_score is null or (coverage_score >= 0 and coverage_score <= 100)),
  active_supply_count   integer not null default 0,

  -- Bags ouverts pour les signaux qui n'ont pas (encore) de colonne
  -- dédiée — jamais un schéma figé qui devrait être migré à chaque
  -- nouveau signal d'Intelligence d'Historique V2 (`history-signals-v2.ts`).
  volatility            jsonb,
  trends                jsonb,
  currencies_observed   jsonb not null default '[]'::jsonb,
  fx_diagnostics        jsonb,

  created_at            timestamptz not null default now()
);
comment on table public.market_snapshot_summaries is 'Résumé compact PAR CYCLE d''instantané, pour analytique historique (LOT "Close the Refresh Loop", section 10) — jamais une recommandation utilisateur (BUY/PASS/REVIEW), jamais un remplacement de market_observations.';

create index idx_market_snapshot_summaries_product_time
  on public.market_snapshot_summaries (product_key, cycle_at desc);

alter table public.market_snapshot_summaries enable row level security;
create policy "market_snapshot_summaries: lecture" on public.market_snapshot_summaries
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement.
