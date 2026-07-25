-- ============================================================
-- 0009 · Row Level Security
-- Principes :
--  · données utilisateur → propriétaire uniquement
--  · données marché → lecture pour tout utilisateur connecté
--  · écritures marché → service role uniquement (aucune policy insert/update)
--  · admin → accès étendu via public.is_admin()
-- ============================================================

-- Identité
alter table public.profiles enable row level security;
create policy "profiles: lecture soi-même ou admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles: mise à jour soi-même" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Anti-élévation de privilèges : le rôle n'est modifiable que par le service role.
-- Les privilèges par colonne s'appliquent AVANT les policies RLS.
revoke update on public.profiles from authenticated;
grant update (display_name, locale, currency, country) on public.profiles to authenticated;

-- Taxonomie & marché : lecture authentifiée, écriture service role
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.attribute_definitions enable row level security;
alter table public.sources enable row level security;
alter table public.listings enable row level security;
alter table public.listing_media enable row level security;
alter table public.price_observations enable row level security;
alter table public.market_aggregates enable row level security;
alter table public.comparable_sets enable row level security;
alter table public.comparable_members enable row level security;
alter table public.scores enable row level security;

create policy "categories: lecture" on public.categories for select to authenticated using (true);
create policy "brands: lecture" on public.brands for select to authenticated using (true);
create policy "attribute_definitions: lecture" on public.attribute_definitions for select to authenticated using (true);
create policy "sources: lecture" on public.sources for select to authenticated using (true);
create policy "listings: lecture" on public.listings for select to authenticated using (true);
create policy "listing_media: lecture" on public.listing_media for select to authenticated using (true);
create policy "price_observations: lecture" on public.price_observations for select to authenticated using (true);
create policy "market_aggregates: lecture" on public.market_aggregates for select to authenticated using (true);
create policy "comparable_sets: lecture" on public.comparable_sets for select to authenticated using (true);
create policy "comparable_members: lecture" on public.comparable_members for select to authenticated using (true);
create policy "scores: lecture" on public.scores for select to authenticated using (true);

-- Fonctionnalités utilisateur : propriétaire uniquement
alter table public.watchlists enable row level security;
create policy "watchlists: crud propriétaire" on public.watchlists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.watchlist_items enable row level security;
create policy "watchlist_items: crud via watchlist" on public.watchlist_items
  for all using (exists (select 1 from public.watchlists w
                         where w.id = watchlist_id and w.user_id = auth.uid()));

alter table public.saved_searches enable row level security;
create policy "saved_searches: crud propriétaire" on public.saved_searches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.alerts enable row level security;
create policy "alerts: crud propriétaire" on public.alerts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.portfolio_positions enable row level security;
create policy "portfolio: crud propriétaire" on public.portfolio_positions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.notifications enable row level security;
create policy "notifications: lecture propriétaire" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications: marquer lu" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Facturation
alter table public.plans enable row level security;
create policy "plans: lecture publique" on public.plans for select using (true);

alter table public.subscriptions enable row level security;
create policy "subscriptions: lecture propriétaire ou admin" on public.subscriptions
  for select using (user_id = auth.uid() or public.is_admin());

alter table public.usage_events enable row level security;
create policy "usage: lecture propriétaire" on public.usage_events
  for select using (user_id = auth.uid());

-- Modules futurs
alter table public.ml_models enable row level security;
create policy "ml_models: lecture admin" on public.ml_models for select using (public.is_admin());
alter table public.ml_predictions enable row level security;
create policy "ml_predictions: lecture admin" on public.ml_predictions for select using (public.is_admin());
alter table public.sale_events enable row level security;
create policy "sale_events: lecture" on public.sale_events for select to authenticated using (true);
alter table public.publication_jobs enable row level security;
create policy "publication_jobs: crud propriétaire" on public.publication_jobs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.marketplace_offers enable row level security;
create policy "marketplace: lecture" on public.marketplace_offers for select to authenticated using (true);
create policy "marketplace: crud vendeur" on public.marketplace_offers
  for all using (seller_id = auth.uid()) with check (seller_id = auth.uid());
