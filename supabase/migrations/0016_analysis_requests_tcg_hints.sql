-- ============================================================
-- 0016 · Hints TCG corrigés manuellement (LOT 8 — scan photo Pokémon)
-- Additive uniquement : une seule colonne nullable ajoutée à une table
-- existante (0012), aucune donnée existante affectée, aucune contrainte
-- retirée. Porte les champs corrigés par l'utilisateur sur l'écran de
-- confirmation (`tcgCardProvidedHintsSchema`, @dealradar/contracts) quand
-- l'extraction visuelle initiale était trop incertaine — n'a de sens que
-- pour `category_slug = 'pokemon_tcg'`, ignorée par toute autre branche du
-- worker `analysis.process`.
--
-- Non appliquée contre une instance réelle dans ce lot (mêmes limites
-- documentées que 0012/0014/0015) — à exécuter contre Supabase avant que
-- le flux de correction ne soit utilisable en production.
-- ============================================================

alter table public.analysis_requests
  add column provided_tcg_hints jsonb;
