-- ============================================================
-- 0026 · Annulation d'analyse INTERACTIVE (LOT "Product History UX +
-- Source Health + Interactive Cancellation + Beta Readiness", section 6/7)
--
-- Le chemin interactif (`POST /v1/analyses` + file `analysis.process` +
-- polling, voir migration 0012) ne peut pas être annulé DIRECTEMENT par un
-- abandon de requête HTTP (le worker qui traite la file continue
-- indépendamment du client) — ce lot ajoute donc un état de demande
-- d'annulation EXPLICITE que le worker consulte lui-même AVANT ses étapes
-- coûteuses (extraction IA, orchestration multi-source), jamais une
-- annulation "devinée" côté client.
--
-- `cancel_requested_at` : posé par le PROPRIÉTAIRE de la requête via la
-- fonction RPC ci-dessous (jamais une policy update générale — même
-- discipline que `analysis_requests` existante : le client ne peut modifier
-- AUCUNE colonne directement). `null` -> aucune annulation demandée.
--
-- `status = 'cancelled'` : nouvel état TERMINAL distinct de `'failed'` —
-- une annulation utilisateur n'est JAMAIS une panne fournisseur (règle
-- absolue du lot, section 7).
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017 à 0025).
-- ============================================================

-- Note honnête (jamais vérifiée contre une instance Postgres réelle ce
-- lot, comme 0012 le documente déjà pour la table elle-même) : le nom de
-- contrainte `analysis_requests_status_check` suit la convention de
-- nommage AUTOMATIQUE de Postgres pour une contrainte `check` inline sur
-- la colonne `status` (`<table>_<colonne>_check`) — à reconfirmer par un
-- `\d analysis_requests` avant toute application réelle si ce nom devait
-- diverger.
alter table public.analysis_requests
  add column cancel_requested_at timestamptz;

alter table public.analysis_requests
  drop constraint analysis_requests_status_check;
alter table public.analysis_requests
  add constraint analysis_requests_status_check
  check (status in ('pending', 'processing', 'completed', 'failed', 'insufficient_data', 'cancelled'));

-- Fonction RPC atomique — SEUL moyen pour le propriétaire de demander une
-- annulation (aucune policy update directe n'existe sur cette table).
-- Retourne `true` si l'annulation a été enregistrée, `false` si la requête
-- est déjà dans un état TERMINAL (jamais réécrit un résultat déjà produit)
-- ou n'appartient pas à l'appelant.
create or replace function public.request_analysis_cancellation(p_analysis_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated boolean;
begin
  update public.analysis_requests
  set cancel_requested_at = now()
  where id = p_analysis_request_id
    and user_id = auth.uid()
    and status in ('pending', 'processing')
    and cancel_requested_at is null
  returning true into v_updated;

  return coalesce(v_updated, false);
end;
$$;

comment on function public.request_analysis_cancellation is 'Annulation interactive (LOT "Product History UX...", section 6/7) — seul moyen pour le propriétaire de marquer sa propre requête pending/processing comme annulation demandée ; jamais un état terminal réécrit.';
