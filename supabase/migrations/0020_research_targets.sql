-- ============================================================
-- 0020 · Cibles de recherche / watchlist (LOT "Historical Data Engine +
-- Product Identity Enrichment + Live-Readiness", section 9)
--
-- Contrat générique pour les produits que DealRadar doit continuer à
-- surveiller — PAS un travail d'interface : cette table permet à UN scan
-- utilisateur d'amorcer automatiquement une intelligence de prix à long
-- terme (voir `packages/core/src/scheduling/snapshot-scheduling-policy.ts`
-- pour la logique PURE qui décide QUAND rafraîchir, jamais branchée sur un
-- scheduler ici — aucun cron déployé par cette migration ni ce lot).
--
-- Écritures : service role uniquement (workers), même politique que les
-- autres tables de ce lot (0019) et des lots précédents (0009/0015/0018).
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017/0018/0019).
-- ============================================================

create table public.research_targets (
  id                   bigint generated always as identity primary key,
  -- Référence LOGIQUE vers `market_products.product_key` — volontairement
  -- pas de contrainte de clé étrangère stricte, même raisonnement que
  -- `market_observations.product_key` (0019) : une cible de recherche
  -- peut être créée en amorçage AVANT que l'identité canonique ne soit
  -- pleinement résolue, jamais une écriture bloquée par un ordre strict.
  product_key          text not null,
  reason               text not null check (reason in ('user_scan', 'watchlist', 'high_activity', 'manual_seed')),
  priority             integer not null default 50 check (priority >= 0 and priority <= 100),
  desired_currency     char(3) not null,
  enabled              boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  last_refreshed_at    timestamptz,
  next_refresh_at      timestamptz,

  -- Une seule cible active par (produit, devise désirée) — un second scan
  -- utilisateur du même produit dans la même devise met à jour la cible
  -- existante (priorité/raison), jamais un doublon silencieux.
  unique (product_key, desired_currency)
);
comment on table public.research_targets is 'Produits que DealRadar surveille dans le temps (LOT "Historical Data Engine", section 9) — pas un objet d''interface, une donnée de planification pure. Aucun scheduler n''est déployé par cette migration.';

-- Requête principale attendue d'un futur job de rafraîchissement : "quelles cibles sont dues, par ordre de priorité" — jamais un scan complet de la table.
create index idx_research_targets_due on public.research_targets (next_refresh_at)
  where enabled = true;
create index idx_research_targets_product on public.research_targets (product_key);

create trigger trg_research_targets_touch before update on public.research_targets
  for each row execute function public.touch_updated_at();

alter table public.research_targets enable row level security;
create policy "research_targets: lecture" on public.research_targets
  for select to authenticated using (true);
-- Aucune policy insert/update/delete : écriture service role uniquement.
