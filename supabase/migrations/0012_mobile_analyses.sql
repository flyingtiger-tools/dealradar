-- ============================================================
-- 0012 · Mobile Copilot — contrat d'analyse universel (ADR 0010).
-- Écritures de statut/résultat : service role (worker) uniquement.
-- Création/lecture de la requête : propriétaire authentifié.
--
-- Limite assumée (même limite documentée depuis le Lot 4/ADR 0009) :
-- Docker/Postgres local reste indisponible dans cet environnement — cette
-- migration n'a pas pu être exécutée contre une instance réelle. Vérifiée
-- par relecture attentive et cohérence avec le style des migrations 0009
-- (RLS) et 0011 (RPC atomique) ; reste à exécuter contre Supabase avant
-- déploiement.
-- ============================================================

-- ── Requêtes d'analyse ────────────────────────────────────────
create table public.analysis_requests (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  client_request_id  uuid not null,
  source_type        text not null check (source_type in (
                        'android_screen_capture', 'ios_share_extension', 'ios_screenshot_share',
                        'mobile_camera', 'image_upload', 'shared_url', 'email_alert',
                        'official_connector', 'manual_entry'
                      )),
  source_platform    text,
  shared_url         text,
  title              text,
  description        text,
  -- L'une des 5 catégories couvertes par Intelligence Core (ADR 0007) —
  -- `null` si l'utilisateur ne l'a pas encore confirmée : le worker renvoie
  -- alors INSUFFICIENT_DATA plutôt que de deviner (voir ADR 0010).
  category_slug      text check (category_slug in ('lego', 'pokemon_tcg', 'apple', 'gaming', 'photo')),
  purchase_price     numeric(12, 2),
  currency           text not null default 'CHF',
  -- [{ "url": "..." }] — jamais le contenu binaire, seulement une référence
  -- vers le bucket analysis-uploads une fois passée par le pipeline de
  -- sécurité image existant (packages/ai/src/image-policy).
  image_references   jsonb not null default '[]'::jsonb,
  consent_version    text not null,
  status             text not null default 'pending' check (status in (
                        'pending', 'processing', 'completed', 'failed', 'insufficient_data'
                      )),
  -- Enveloppe validée par analysisResultSchema (@dealradar/contracts) — jamais écrite par le client.
  result             jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, client_request_id)
);
create index idx_analysis_requests_user on public.analysis_requests (user_id, created_at desc);
create index idx_analysis_requests_status on public.analysis_requests (status) where status in ('pending', 'processing');

alter table public.analysis_requests enable row level security;

-- Le client (JWT utilisateur) crée et lit sa propre requête ; il ne peut
-- jamais modifier `status`/`result` lui-même (aucune policy update pour
-- `authenticated` — seul le service role, qui contourne RLS, le fait).
create policy "analysis_requests: création propriétaire" on public.analysis_requests
  for insert to authenticated with check (user_id = auth.uid());
create policy "analysis_requests: lecture propriétaire" on public.analysis_requests
  for select to authenticated using (user_id = auth.uid());

-- ── Rate limiting — même patron atomique que reserve_ai_budget (0011) ────
-- Fenêtre fixe par (utilisateur, bucket), verrouillée par advisory lock pour
-- éviter la course entre requêtes concurrentes d'un même utilisateur.
create table public.api_rate_limit_windows (
  user_id       uuid not null,
  bucket        text not null,
  window_start  bigint not null,
  request_count int not null default 0,
  primary key (user_id, bucket, window_start)
);

-- Retourne true si la requête est autorisée (et compte comme consommée),
-- false si la limite pour la fenêtre courante est déjà atteinte. Le nombre
-- de fenêtres passées n'est jamais recalculé après coup : la limite ne
-- peut donc jamais être dépassée par une course entre workers/requêtes.
create or replace function public.check_and_increment_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_window_seconds int,
  p_max_count int
) returns boolean
language plpgsql as $$
declare
  v_window_start bigint;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || p_bucket));

  v_window_start := (extract(epoch from now())::bigint / p_window_seconds) * p_window_seconds;

  insert into public.api_rate_limit_windows (user_id, bucket, window_start, request_count)
  values (p_user_id, p_bucket, v_window_start, 0)
  on conflict (user_id, bucket, window_start) do nothing;

  select request_count into v_count
  from public.api_rate_limit_windows
  where user_id = p_user_id and bucket = p_bucket and window_start = v_window_start
  for update;

  if v_count >= p_max_count then
    return false;
  end if;

  update public.api_rate_limit_windows
  set request_count = request_count + 1
  where user_id = p_user_id and bucket = p_bucket and window_start = v_window_start;

  return true;
end;
$$;

-- Purge manuelle des fenêtres expirées (même politique que purge_expired_ai_cache, 0011).
create or replace function public.purge_expired_rate_limit_windows(p_older_than_seconds int default 86400)
returns void language sql as $$
  delete from public.api_rate_limit_windows
  where window_start < (extract(epoch from now())::bigint - p_older_than_seconds);
$$;

alter table public.api_rate_limit_windows enable row level security;
-- Aucune policy : table purement opérationnelle, accès service role uniquement.

-- ── Stockage des captures/photos — bucket privé, propriétaire uniquement ─
insert into storage.buckets (id, name, public)
values ('analysis-uploads', 'analysis-uploads', false)
on conflict (id) do nothing;

-- Convention de chemin : `<user_id>/<analysis_request_id>/<fichier>` — le
-- premier segment du chemin est toujours l'utilisateur propriétaire.
create policy "analysis-uploads: lecture propriétaire" on storage.objects
  for select to authenticated
  using (bucket_id = 'analysis-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "analysis-uploads: écriture propriétaire" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'analysis-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "analysis-uploads: suppression propriétaire" on storage.objects
  for delete to authenticated
  using (bucket_id = 'analysis-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Suppression de compte — purge en cascade des fichiers ────────────────
-- `analysis_requests` est déjà purgée par le `on delete cascade` de la FK
-- vers `auth.users`. Les objets Storage n'ont pas de FK équivalente : cette
-- fonction doit être appelée (service role) avant/à la suppression du
-- compte pour ne rien laisser derrière.
create or replace function public.purge_analysis_uploads_for_user(p_user_id uuid)
returns void language sql as $$
  delete from storage.objects
  where bucket_id = 'analysis-uploads'
    and (storage.foldername(name))[1] = p_user_id::text;
$$;
