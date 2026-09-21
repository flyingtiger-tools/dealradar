-- ============================================================
-- 0019 · Identité produit canonique (LOT "Historical Data Engine +
-- Product Identity Enrichment + Live-Readiness", section 3)
--
-- Persiste `CanonicalProductIdentity` (packages/core/src/identity/
-- canonical-product-identity.ts) : UN produit canonique DealRadar,
-- indépendant de la manière dont chaque source (eBay, BrickLink,
-- PriceCharting, Keepa, Google Shopping, DataForSEO...) l'identifie chez
-- elle. `market_product_identifiers` porte les identifiants/attributs
-- structurels affirmés par source, AVEC provenance et confiance — jamais
-- un champ nu sans savoir qui l'affirme.
--
-- Volontairement PAS de contrainte de clé étrangère depuis
-- `market_observations.product_key` (0018) vers `market_products.
-- product_key` : cette colonne existait déjà, nullable, jamais renseignée
-- par une migration antérieure — ajouter une FK stricte casserait
-- potentiellement des lignes déjà écrites ou empêcherait la création d'un
-- nouveau `product_key` avant que `market_products` ne le connaisse
-- (ordre d'écriture chronologique normal : une observation peut précéder
-- la résolution de son identité canonique). La cohérence reste assurée au
-- niveau applicatif (`packages/ingestion`), jamais forcée ici au prix
-- d'une migration destructive sur les lignes existantes — exigence
-- explicite du lot.
--
-- Écritures : service role uniquement (workers), même politique que
-- `market_observations`/`fx_rates` (0009/0015/0018).
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017/0018).
-- ============================================================

create table public.market_products (
  -- Clé interne DealRadar stable — voir `deriveProductKey`, packages/core.
  -- Jamais un identifiant externe (UPC/ASIN/etc.), ceux-ci vivent dans
  -- `market_product_identifiers` ci-dessous.
  product_key                    text primary key,
  category_slug                  text not null,

  -- Champs descriptifs "doux" (LOT, `SOFT_FIELDS`) — la meilleure claim
  -- connue au moment de la dernière fusion, jamais un historique complet
  -- ici (voir `market_product_identifiers` pour la provenance détaillée
  -- de CHAQUE champ, y compris ceux-ci).
  brand                           text,
  model                           text,
  variant                         text,
  color                           text,
  generation                      text,
  region                          text,
  language                        text,
  style_code                      text,
  sku                             text,
  normalized_condition_target     text,

  first_seen_at                   timestamptz not null default now(),
  last_seen_at                    timestamptz not null default now(),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
comment on table public.market_products is 'Identité produit canonique DealRadar — voir packages/core/src/identity/canonical-product-identity.ts. Jamais un identifiant externe fabriqué.';

create index idx_market_products_category on public.market_products (category_slug);

create trigger trg_market_products_touch before update on public.market_products
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Identifiants/attributs structurels AVEC PROVENANCE (LOT, `FieldClaim`)
-- — un même champ peut porter PLUSIEURS lignes (une par source qui
-- l'affirme), jamais un seul champ nu écrasé silencieusement. Les champs
-- "durs" (`HARD_CONFLICT_FIELDS`, packages/core) vivent ici, PAS sur
-- `market_products` elle-même, précisément parce qu'un désaccord entre
-- deux sources doit rester représentable (plusieurs lignes pour le même
-- `(product_key, field)` avec des `value` différentes = un conflit non
-- résolu, jamais un écrasement).
-- ------------------------------------------------------------
create table public.market_product_identifiers (
  id              bigint generated always as identity primary key,
  product_key     text not null references public.market_products (product_key) on delete cascade,
  -- Nom de champ STRUCTURÉ (voir `ALL_IDENTITY_FIELDS`, packages/core) OU
  -- nom LIBRE d'alias spécifique à une source (ex. "googleProductId") —
  -- volontairement AUCUNE contrainte `check` fermée ici : les alias sont
  -- par nature ouverts (`CanonicalProductIdentity.aliases[].field`,
  -- packages/core), une liste fermée les rejetterait à l'écriture.
  field           text not null,
  value           text not null,
  -- Nom de source (connecteur, "ai_identification", "barcode_scan",
  -- "user_scan"...) — jamais une valeur de credential.
  source          text not null,
  confidence      numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  observed_at     timestamptz not null,
  created_at      timestamptz not null default now(),

  -- Idempotence : la même affirmation (même produit, champ, valeur,
  -- source) ne se duplique jamais. Deux SOURCES différentes affirmant
  -- deux VALEURS différentes pour le même champ dur créent bien deux
  -- lignes distinctes — c'est exactement le conflit représentable exigé
  -- par le lot, jamais fusionné au niveau du schéma.
  unique (product_key, field, value, source)
);
comment on table public.market_product_identifiers is 'Affirmations d''identifiant/attribut par source, avec provenance et confiance — voir packages/core/src/identity/merge-identity-evidence.ts. Un désaccord entre sources reste représentable (plusieurs lignes), jamais silencieusement écrasé.';

-- Recherche d'un produit déjà connu PAR IDENTIFIANT (UPC/EAN/MPN/ASIN/
-- référence/id de source) — le chemin le plus fréquent pour éviter de
-- créer un doublon de `market_products`.
create index idx_market_product_identifiers_lookup on public.market_product_identifiers (field, value);
create index idx_market_product_identifiers_product on public.market_product_identifiers (product_key);

alter table public.market_products enable row level security;
create policy "market_products: lecture" on public.market_products
  for select to authenticated using (true);

alter table public.market_product_identifiers enable row level security;
create policy "market_product_identifiers: lecture" on public.market_product_identifiers
  for select to authenticated using (true);
-- Aucune policy insert/update/delete sur les deux tables : écriture service role uniquement.
