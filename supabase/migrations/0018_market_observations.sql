-- ============================================================
-- 0018 · Observations de marché multi-source (LOT "Multi-Source
-- Market Intelligence Foundation")
-- Persiste `MarketObservation` (packages/connectors/src/market-
-- intelligence/market-observation.ts) tel quel, pour TOUTE catégorie et
-- TOUTE source (pas seulement TCG — voir `tcg_price_observations`,
-- 0014_tcg_price_observations.sql, qui reste la table dédiée à l'identité
-- catalogue↔pricing exact_match des cartes/produits scellés et n'est PAS
-- modifiée ici). Append-only, une ligne par observation réellement
-- distincte dans le temps — jamais une conversion, jamais un prix inventé.
--
-- Écritures : service role uniquement (workers), même politique que
-- `price_observations`/`tcg_price_observations` (0004/0009/0014).
--
-- IMPORTANT : cette migration est committée sur la branche mais N'EST PAS
-- appliquée à la production depuis cette session (garde-fou "Production
-- Deploy" de l'outillage, comportement attendu — voir le BUILDER HANDOFF
-- du lot précédent pour un précédent identique avec
-- `0017_analysis_requests_category_slug_expand.sql`). L'application reste
-- une action humaine délibérée.
-- ============================================================

create table public.market_observations (
  id                   bigint generated always as identity primary key,

  source               text not null,
  source_item_id       text not null,
  source_url           text,
  observed_at          timestamptz not null,

  -- Clé produit canonique DealRadar si déjà résolue au moment de la
  -- collecte (ex. via un Catalog Connector) — `null` sinon, jamais
  -- fabriquée après coup par cette table elle-même.
  product_key          text,
  category_slug        text not null,
  query                text not null,

  title                text not null,
  brand                text,
  model                text,
  variant              text,
  -- Identifiants structurels connus (MPN/EAN/UPC/etc.) — bag ouvert.
  identifiers          jsonb not null default '{}'::jsonb,

  condition            text,
  completeness         text,

  price_cents          bigint not null check (price_cents >= 0),
  currency             char(3) not null,
  shipping_cost_cents  bigint check (shipping_cost_cents is null or shipping_cost_cents >= 0),
  total_price_cents    bigint check (total_price_cents is null or total_price_cents >= 0),

  country               text,
  marketplace           text not null,

  evidence_type         text not null check (evidence_type in (
    'activeListings', 'soldTransactions', 'retailPrices', 'historicalPrices',
    'bidAsk', 'productDetails', 'barcodeLookup', 'search'
  )),
  evidence_tier         text not null check (evidence_tier in ('A', 'B', 'C', 'D', 'E')),
  -- Vente RÉELLEMENT confirmée par la source uniquement — jamais déduite
  -- d'une disparition d'annonce (règle absolue du lot, appliquée dès le
  -- schéma : aucune colonne "listing_disappeared_at implies sold" ici).
  sold_at               timestamptz,

  match_score           numeric(4, 3) not null check (match_score >= 0 and match_score <= 1),

  -- Snapshot minimisé du payload source (jamais le payload HTTP brut
  -- complet/un secret) — même discipline que `tcg_price_observations.
  -- raw_payload` / `NormalizedListing.meta.rawPayloadRef` (ebay/redact.ts).
  raw_metadata           jsonb,

  ingestion_version      integer not null default 1,
  created_at             timestamptz not null default now(),

  -- Idempotence : même source+item+horodatage observé = même ligne (upsert
  -- en place). Un prix qui change à un NOUVEL horodatage crée une nouvelle
  -- ligne — l'historique est préservé, jamais écrasé (même principe que
  -- `tcg_price_observations`, voir son commentaire d'unicité).
  unique (source, source_item_id, observed_at)
);

-- Requêtes par produit dans le temps (construction d'historique).
create index idx_market_obs_product_time
  on public.market_observations (product_key, observed_at desc)
  where product_key is not null;

-- Requêtes par catégorie/type de preuve dans le temps (agrégation multi-source).
create index idx_market_obs_category_evidence_time
  on public.market_observations (category_slug, evidence_type, observed_at desc);

-- Requêtes par source dans le temps (diagnostics/santé de source).
create index idx_market_obs_source_time
  on public.market_observations (source, observed_at desc);

alter table public.market_observations enable row level security;
create policy "market_observations: lecture" on public.market_observations
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement.
