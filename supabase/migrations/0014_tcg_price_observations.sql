-- ============================================================
-- 0014 · Observations de prix TCG (ADR 0012, LOT 5)
-- Persiste les résultats `exact_match` du mapping catalogue↔pricing
-- (aujourd'hui : Pokémon TCG API ↔ JustTCG). Append-only, une ligne par
-- observation de prix réellement distincte — jamais une conversion, jamais
-- une correspondance probable/ambiguous/no_match. Écritures : service role
-- (workers) uniquement, comme `price_observations` (0004/0009).
--
-- Nom de table volontairement générique (`tcg_price_observations`, pas
-- `justtcg_price_observations`) : `source` distingue déjà la provenance et
-- rien n'empêche un futur Pricing Connector TCG (Scrydex, PriceCharting une
-- fois l'autorisation obtenue) d'alimenter la même table sans migration
-- supplémentaire — cohérent avec l'absence de nom de connecteur en dur déjà
-- appliquée au Capability Engine (LOT 4).
-- ============================================================

create table public.tcg_price_observations (
  id                   bigint generated always as identity primary key,

  -- Provenance de l'observation de prix elle-même (ex. "justtcg").
  source               text not null,
  external_product_id  text not null,

  -- Identité catalogue résolue par le Catalog Connector (ex. "pokemon-tcg-api" + id de carte).
  catalog_source        text not null,
  catalog_external_id   text not null,

  category_slug        text not null,
  game                  text not null,
  name                  text not null,
  set_name              text,
  card_number           text,

  -- Sentinelle '' (jamais null) pour ces cinq colonnes : elles participent à
  -- la clé d'unicité ci-dessous, et Postgres traite deux `null` comme
  -- distincts dans une contrainte unique — une carte brute sans grade
  -- créerait alors une nouvelle ligne à chaque écriture au lieu de
  -- fusionner. `''` porte le même sens ("non applicable / inconnu") sans ce
  -- piège.
  variant               text not null default '',
  language              text not null default '',
  condition             text not null default '',
  grading_company       text not null default '',
  grade                 text not null default '',

  -- Raw/gradé uniquement : un produit scellé n'atteint jamais cette table
  -- (`classifyCrossMatch` refuse déjà tout `productKind` hors de ces deux
  -- valeurs avant même de produire un `exact_match`).
  product_kind          text not null check (product_kind in ('raw_card', 'graded_card')),

  amount_cents          bigint not null check (amount_cents >= 0),
  -- Devise d'origine telle que renvoyée par la source — jamais convertie ici.
  currency              char(3) not null,
  price_type            text not null check (price_type in ('market_aggregate', 'listing', 'sold')),
  -- Région de marché de la source (ex. "US") — jamais présentée comme une autre région.
  region                text not null,
  provenance            text not null,
  confidence            numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  -- Avertissements cross-market (ex. "marché nord-américain, ne représente pas une valeur CH/EU") — jamais perdus.
  warnings              jsonb not null default '[]'::jsonb,

  -- Défense en profondeur : même une écriture directe hors du code
  -- applicatif ne peut jamais insérer autre chose qu'un exact_match ici.
  match_outcome         text not null default 'exact_match' check (match_outcome = 'exact_match'),

  -- Snapshot minimisé de l'observation normalisée (déjà dépouillée de tout
  -- payload HTTP brut/secret par le Pricing Connector, voir LOT 2) — pour
  -- traçabilité/debug, jamais une source de vérité supplémentaire.
  raw_payload           jsonb,

  -- Quand DealRadar a capturé cette observation (maintenant, à l'écriture) —
  -- distinct de `source_updated_at` (quand JustTCG a lui-même mis à jour ce
  -- prix, peut être `null` si la source ne le fournit pas).
  observed_at           timestamptz not null default now(),
  source_updated_at     timestamptz,
  created_at            timestamptz not null default now(),

  -- Idempotence : la même carte/variante/langue/gradation/devise/région,
  -- observée deux fois avec un prix identique, ne crée jamais de doublon
  -- (upsert en place, `observed_at`/`source_updated_at`/`raw_payload`
  -- rafraîchis). Un prix qui change (amount_cents différent) crée une
  -- nouvelle ligne — l'historique est préservé, jamais écrasé.
  unique (
    source, external_product_id, catalog_source, catalog_external_id,
    currency, region, price_type,
    condition, grading_company, grade, variant, language,
    amount_cents
  )
);

create index idx_tcg_price_obs_instrument
  on public.tcg_price_observations (source, external_product_id, catalog_source, catalog_external_id, observed_at desc);
create index idx_tcg_price_obs_catalog
  on public.tcg_price_observations (catalog_source, catalog_external_id, observed_at desc);

alter table public.tcg_price_observations enable row level security;
create policy "tcg_price_observations: lecture" on public.tcg_price_observations
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement (même politique que price_observations, 0009).
