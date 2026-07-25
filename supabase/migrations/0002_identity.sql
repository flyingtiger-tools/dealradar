-- ============================================================
-- 0002 · Identité, rôles, préférences
-- ============================================================

create type public.user_role as enum ('free', 'premium', 'admin');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'free',
  display_name text,
  locale      text not null default 'fr',
  currency    char(3) not null default 'CHF',
  country     char(2) not null default 'CH',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'Profil applicatif, 1:1 avec auth.users.';

-- Création automatique du profil à l'inscription
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers d'autorisation utilisés par les policies RLS
create function public.current_role_is(required public.user_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = required);
$$;

create function public.is_admin()
returns boolean language sql stable as $$
  select public.current_role_is('admin');
$$;

-- Horodatage automatique
create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
