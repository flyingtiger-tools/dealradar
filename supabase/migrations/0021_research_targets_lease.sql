-- ============================================================
-- 0021 · Bail de traitement (claim/lease) sur les cibles de recherche
-- (LOT "Close the Refresh Loop + Operational Hardening + Activation
-- Harness", section 2)
--
-- Ajoute la concurrence sûre à `research_targets` (0020) : deux instances
-- workers ne doivent jamais rafraîchir le MÊME produit en même temps.
-- Additive uniquement (ALTER TABLE ADD COLUMN) — jamais une réécriture
-- destructive de 0020, aucune ligne existante perdue.
--
-- `claim_research_target` fait la vérification ET l'écriture du bail dans
-- UNE SEULE instruction SQL (`UPDATE ... FROM (SELECT ... FOR UPDATE SKIP
-- LOCKED)`), le seul moyen réellement ATOMIQUE d'éviter une fenêtre de
-- concurrence entre "lire quelles cibles sont dues" et "écrire le bail" —
-- une paire lecture-puis-écriture séparée côté application NE PEUT PAS
-- garantir cette atomicité (LOT, section 2 : "atomic claim behavior at DB
-- level where feasible").
--
-- Écritures : service role uniquement (workers), même politique que les
-- autres tables de ce lot et des lots précédents.
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017 à 0020).
-- ============================================================

alter table public.research_targets
  -- Identifiant libre du bailleur (ex. un id de process/instance workers) — jamais un secret, jamais loggé comme tel.
  add column claimed_by         text,
  add column claimed_at         timestamptz,
  -- Un bail expiré peut être repris par un AUTRE bailleur — voir `claim_research_target`. Jamais un verrou permanent (LOT : "no permanent lock").
  add column lease_expires_at   timestamptz,
  add column attempt_count      integer not null default 0,
  -- Résumé SANS DONNÉE SENSIBLE (jamais une URL de requête complète ni une valeur de credential) — voir `packages/core/src/scheduling/refresh-retry-policy.ts` pour la classification de raison associée.
  add column last_error         text,
  add column last_success_at    timestamptz,
  add column consecutive_failures integer not null default 0;

comment on column public.research_targets.claimed_by is 'Bailleur actuel (id de process workers) — null = libre. Voir claim_research_target pour l''acquisition atomique.';
comment on column public.research_targets.lease_expires_at is 'Un bail dont l''échéance est dépassée est considéré libre — permet la récupération après un crash workers sans intervention humaine (LOT, section 2).';

-- Requête de reprise ("quels bails ont expiré") — jamais un scan complet.
create index idx_research_targets_lease on public.research_targets (lease_expires_at)
  where claimed_by is not null;

-- ------------------------------------------------------------
-- Acquisition atomique — combine la sélection ("dû, activé, libre ou bail
-- expiré, trié par priorité puis ancienneté") et l'écriture du bail en UNE
-- transaction implicite. `FOR UPDATE SKIP LOCKED` : une ligne déjà
-- verrouillée par une autre transaction concurrente est simplement
-- ignorée (jamais une attente bloquante), exactement le comportement
-- "un worker ne peut jamais voler le bail actif d'un autre" du lot.
-- ------------------------------------------------------------
create function public.claim_research_target(
  p_lease_owner text,
  p_lease_duration_seconds integer,
  p_limit integer default 1
)
returns setof public.research_targets
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.research_targets t
  set claimed_by = p_lease_owner,
      claimed_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_duration_seconds),
      attempt_count = t.attempt_count + 1,
      updated_at = now()
  from (
    select id
    from public.research_targets
    where enabled = true
      and (next_refresh_at is null or next_refresh_at <= now())
      and (claimed_by is null or lease_expires_at < now())
    order by priority desc, coalesce(next_refresh_at, 'epoch'::timestamptz) asc, id asc
    limit p_limit
    for update skip locked
  ) as due
  where t.id = due.id
  returning t.*;
end;
$$;
comment on function public.claim_research_target is 'Acquisition atomique de bail (LOT "Close the Refresh Loop", section 2) — jamais appelée en dehors du service role. Ne renvoie jamais une cible désactivée, non due, ou déjà sous bail actif d''un autre bailleur.';

-- ------------------------------------------------------------
-- Libération explicite — toujours appelée par le bailleur qui détient le
-- bail (le WHERE claimed_by = p_lease_owner empêche de libérer le bail de
-- QUELQU'UN D'AUTRE par erreur). Un bail simplement laissé à expirer (ex.
-- crash workers) est récupéré automatiquement par `claim_research_target`
-- ci-dessus — cette fonction n'est qu'un chemin de libération PROPRE,
-- jamais le seul mécanisme de récupération.
-- ------------------------------------------------------------
create function public.release_research_target(p_target_id bigint, p_lease_owner text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.research_targets
  set claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_target_id
    and claimed_by = p_lease_owner;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
comment on function public.release_research_target is 'Libération explicite d''un bail — ne libère jamais le bail d''un autre bailleur (LOT "Close the Refresh Loop", section 2).';
