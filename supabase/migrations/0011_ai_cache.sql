-- ============================================================
-- 0011 · AI Extraction Engine — cache versionné, budget atomique,
-- persistance des images (Lot 5). Écritures : service role (workers) uniquement.
-- ============================================================

-- ── Correction du gap Lot 4 : persist-listing.ts ne persistait jamais les
-- images collectées par le connecteur (listing_media restait vide). ──────
alter table public.listing_media
  -- Hash/fingerprint du contenu réellement téléchargé, quand disponible —
  -- utilisé par packages/ai pour un fingerprint de cache résistant aux
  -- changements d'URL signée (cf. ADR 0009).
  add column content_hash text,
  add column validation_status text not null default 'pending'
    check (validation_status in ('pending', 'valid', 'rejected'));

-- Upsert idempotent par (listing_id, source_url) — persist-listing.ts fait
-- désormais un upsert plutôt qu'un delete-then-insert non atomique, pour ne
-- jamais laisser une annonce sans images en cas d'échec partiel.
create unique index ux_listing_media_listing_url on public.listing_media (listing_id, source_url);

-- ── Cache d'extraction IA — versionné et paresseux ───────────────────────
-- La clé (calculée côté application, packages/ai/src/cache/compute-key.ts)
-- intègre déjà provider/modèle/versions/fingerprint ; les colonnes ci-dessous
-- ne sont pas une seconde source de vérité mais une trace lisible en base,
-- utile pour le diagnostic et la purge.
create table public.ai_extraction_cache (
  cache_key             text primary key,
  provider              text not null,
  model                 text not null,
  prompt_version        int not null,
  schema_version        int not null,
  deterministic_version int not null,
  result                jsonb not null,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  last_used_at          timestamptz not null default now()
);
create index idx_ai_extraction_cache_expires on public.ai_extraction_cache (expires_at);

-- Purge manuelle des entrées expirées — pas de planification automatique
-- dans ce lot, même politique que purge_raw_payloads (migration 0010).
create or replace function public.purge_expired_ai_cache()
returns void language sql as $$
  delete from public.ai_extraction_cache where expires_at < now();
$$;

-- ── Budget IA — réservation atomique ──────────────────────────────────────
-- Un simple "getTodaySpendUsd() → appel IA → recordUsage()" est vulnérable à
-- une course entre workers concurrents (deux workers pourraient consommer le
-- même reliquat de budget avant que l'un des deux n'ait enregistré sa
-- dépense). `reserve_ai_budget` réserve un coût maximal estimé de façon
-- transactionnelle, sérialisée par (provider, jour) via un verrou
-- consultatif — voir packages/ai/src/budget/types.ts (BudgetGuard) et
-- packages/ingestion/src/ai-budget-supabase.ts pour le câblage.
create table public.ai_usage_log (
  id                 uuid primary key default gen_random_uuid(),
  occurred_at        timestamptz not null default now(),
  listing_id         uuid references public.listings (id) on delete set null,
  provider           text not null,
  model              text not null,
  -- Coût maximal réservé avant l'appel (jamais dépassé, garantit le budget).
  reserved_cost_usd  numeric(10, 6) not null,
  -- Coût réel une fois l'appel terminé — toujours une ESTIMATION calculée
  -- depuis les unités retournées par l'API et une table tarifaire versionnée
  -- (packages/ai/src/observability/cost-table.ts), jamais une facture
  -- officielle du provider.
  estimated_cost_usd numeric(10, 6),
  input_units        int,
  output_units       int,
  status             text not null check (status in ('reserved', 'completed', 'failed', 'released'))
);
create index idx_ai_usage_log_provider_day on public.ai_usage_log (provider, occurred_at);

-- Réserve atomiquement un coût maximal pour un appel IA à venir. Retourne
-- l'identifiant de réservation, ou NULL si le budget journalier restant est
-- insuffisant (aucun appel réseau ne doit alors avoir lieu côté application).
create or replace function public.reserve_ai_budget(
  p_provider text,
  p_model text,
  p_max_cost_usd numeric,
  p_daily_budget_usd numeric,
  p_listing_id uuid
) returns uuid
language plpgsql as $$
declare
  v_spent numeric;
  v_id uuid;
begin
  -- Sérialise toutes les réservations pour ce provider et ce jour — deux
  -- appels concurrents ne peuvent jamais lire le même solde avant que l'un
  -- des deux n'ait inséré sa réservation.
  perform pg_advisory_xact_lock(hashtext(p_provider || to_char(now(), 'YYYY-MM-DD')));

  select coalesce(sum(reserved_cost_usd), 0) into v_spent
  from public.ai_usage_log
  where provider = p_provider
    and occurred_at::date = current_date
    and status in ('reserved', 'completed');

  if v_spent + p_max_cost_usd > p_daily_budget_usd then
    return null;
  end if;

  insert into public.ai_usage_log (listing_id, provider, model, reserved_cost_usd, status)
  values (p_listing_id, p_provider, p_model, p_max_cost_usd, 'reserved')
  returning id into v_id;

  return v_id;
end;
$$;

-- Ajuste une réservation avec le résultat réel de l'appel (succès ou échec).
create or replace function public.finalize_ai_budget(
  p_reservation_id uuid,
  p_status text,
  p_input_units int,
  p_output_units int,
  p_estimated_cost_usd numeric
) returns void
language sql as $$
  update public.ai_usage_log
  set status = p_status,
      input_units = p_input_units,
      output_units = p_output_units,
      estimated_cost_usd = p_estimated_cost_usd
  where id = p_reservation_id;
$$;

-- Libère une réservation jamais consommée (abandon avant tout appel réseau réel).
create or replace function public.release_ai_budget(p_reservation_id uuid)
returns void language sql as $$
  update public.ai_usage_log set status = 'released' where id = p_reservation_id;
$$;

-- ── RLS ───────────────────────────────────────────────────────
-- Aucune policy sur les deux tables ci-dessous : purement opérationnelles,
-- accès service role uniquement, aucun besoin d'exposition UI dans ce lot.
alter table public.ai_extraction_cache enable row level security;
alter table public.ai_usage_log enable row level security;
