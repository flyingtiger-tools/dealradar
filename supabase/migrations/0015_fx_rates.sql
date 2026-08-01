-- ============================================================
-- 0015 · Taux de change traçables (ADR 0012, LOT 6)
-- Audit trail des taux de change effectivement récupérés — jamais un taux
-- codé en dur, jamais une valeur "courante" implicite. Chaque ligne fige un
-- taux à une date précise, pour une paire précise, depuis une source
-- précise. Écritures : service role (workers) uniquement, même politique
-- que les autres tables d'observation (0004/0009/0014).
--
-- Ne persiste ici que le TAUX lui-même — la conversion d'une observation de
-- prix précise (`CrossMarketConversion`) reste un objet en mémoire produit
-- par `convertPriceObservation` (packages/connectors/src/fx/convert.ts),
-- non encore écrit dans `tcg_price_observations` : brancher cette étape
-- est un chantier futur explicitement hors de ce lot.
-- ============================================================

create table public.fx_rates (
  id              bigint generated always as identity primary key,
  base_currency   char(3) not null,
  quote_currency  char(3) not null,
  rate            numeric(18, 8) not null check (rate > 0),
  -- Date à laquelle ce taux s'applique (ex. la date de publication côté
  -- source) — distincte de `fetched_at` (quand DealRadar l'a récupéré).
  rate_date       date not null,
  source          text not null,
  fetched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  -- Idempotence : un même (source, paire, date) ne se duplique jamais — un
  -- nouvel appel pour un taux déjà connu rafraîchit seulement `fetched_at`.
  unique (base_currency, quote_currency, rate_date, source)
);
create index idx_fx_rates_pair on public.fx_rates (base_currency, quote_currency, rate_date desc);

alter table public.fx_rates enable row level security;
create policy "fx_rates: lecture" on public.fx_rates
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement.
