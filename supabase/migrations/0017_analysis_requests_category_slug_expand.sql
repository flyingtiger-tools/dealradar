-- LOT "Railway worker recovery + real non-TCG E2E" — le contrat
-- (`packages/contracts/src/category-slug.ts`, `categorySlugSchema`) et le
-- sélecteur de catégorie mobile (LOT "rendre le scan universel accessible
-- dans l'app") couvrent 10 catégories depuis le LOT "Universal Object
-- Valuation Foundation" (lego, pokemon_tcg, apple, gaming, photo, sneakers,
-- watches, pc_components, collectibles, general) — cette contrainte
-- `check` n'avait jamais été élargie en base au-delà des 5 catégories
-- d'origine (0012_mobile_analyses.sql). Bug réel trouvé en traitant une
-- vraie requête "watches" : `INSERT`/`UPDATE` rejeté en base avec
-- `analysis_requests_category_slug_check`, alors que le contrat/l'API
-- l'acceptent — 5 des 10 catégories affichées dans l'app ne pouvaient
-- jamais aboutir. Élargit la contrainte pour couvrir exactement les mêmes
-- 10 valeurs que `categorySlugSchema`, jamais une valeur en plus.
alter table public.analysis_requests
  drop constraint analysis_requests_category_slug_check;

alter table public.analysis_requests
  add constraint analysis_requests_category_slug_check
  check (category_slug in (
    'lego', 'pokemon_tcg', 'apple', 'gaming', 'photo',
    'sneakers', 'watches', 'pc_components', 'collectibles', 'general'
  ));
