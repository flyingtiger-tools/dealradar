-- ============================================================
-- 0022 · Persistance du cycle de vie d'annonce (LOT "Close the Refresh
-- Loop + Operational Hardening + Activation Harness", section 9)
--
-- Persiste `ListingLifecycleState` (packages/core/src/intelligence/
-- listing-lifecycle.ts, moteur PUR déjà existant et testé — non modifié
-- par cette migration) : combien de fois et depuis quand une annonce
-- ACTIVE précise est observée, à travers des cycles d'instantané
-- successifs.
--
-- RÈGLE ABSOLUE, appliquée au niveau du schéma : `disappeared_at` et
-- `confirmed_sold_at` sont deux colonnes DISTINCTES, jamais dérivées l'une
-- de l'autre. Aucun trigger/valeur par défaut ne renseigne jamais
-- `confirmed_sold_at` à partir d'une disparition — seule une écriture
-- APPLICATIVE explicite peut le faire, et uniquement quand une source l'a
-- confirmé (voir `listing-lifecycle.ts`, `ListingObservationEvent.
-- confirmedSoldAt`).
--
-- Écritures : service role uniquement (workers), même politique que les
-- autres tables de ce lot et des lots précédents.
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017 à 0021).
-- ============================================================

create table public.listing_lifecycles (
  id                 bigint generated always as identity primary key,
  source             text not null,
  source_item_id     text not null,
  -- Référence LOGIQUE vers `market_products.product_key` — volontairement
  -- pas de contrainte de clé étrangère stricte, même raisonnement que
  -- `market_observations.product_key` (0019) et `research_targets.
  -- product_key` (0020).
  product_key        text,

  first_seen_at      timestamptz not null,
  last_seen_at       timestamptz not null,
  observed_count     integer not null default 1 check (observed_count >= 1),
  currently_seen     boolean not null default true,
  disappeared_at     timestamptz,
  -- Vente RÉELLEMENT confirmée par la source, jamais déduite de
  -- `disappeared_at` (règle absolue, voir l'en-tête du fichier).
  confirmed_sold_at  timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Une seule ligne de cycle de vie par annonce réelle (source + id chez
  -- la source) — idempotent, un instantané répété sur la même annonce met
  -- à jour la ligne existante, jamais un doublon.
  unique (source, source_item_id)
);
comment on table public.listing_lifecycles is 'Cycle de vie d''annonces actives, sans vente fabriquée (LOT "Close the Refresh Loop", section 9) — voir packages/core/src/intelligence/listing-lifecycle.ts pour le moteur pur. disappeared_at != confirmed_sold_at, toujours.';

create index idx_listing_lifecycles_product on public.listing_lifecycles (product_key)
  where product_key is not null;
-- Requête de reconciliation attendue à chaque cycle d'instantané : "quelles annonces actives connues n'ont pas été revues ce cycle".
create index idx_listing_lifecycles_currently_seen on public.listing_lifecycles (currently_seen, last_seen_at);

create trigger trg_listing_lifecycles_touch before update on public.listing_lifecycles
  for each row execute function public.touch_updated_at();

alter table public.listing_lifecycles enable row level security;
create policy "listing_lifecycles: lecture" on public.listing_lifecycles
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement.
