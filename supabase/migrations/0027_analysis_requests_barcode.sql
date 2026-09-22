-- ============================================================
-- 0027 · Code-barres EXACT sur analysis_requests (LOT "Live Identity
-- Enrichment + Barcode-First + upc.dev Fallback + Railway Readiness",
-- section 1/2)
--
-- Capturé côté mobile (déjà normalisé en forme GTIN native — EAN-13/EAN-8/
-- UPC-A/GTIN-14, voir `apps/mobile/src/capture/normalize-barcode.ts`),
-- transmis avec la requête d'analyse interactive. `null` = aucun
-- code-barres exploitable détecté (aucun scanné, ou uniquement des formats
-- non-GTIN/`upc_e`, jamais un identifiant deviné côté client).
--
-- Consommé par `process-analysis.ts` (chemin GÉNÉRIQUE uniquement, jamais
-- pour `category_slug = 'pokemon_tcg'`) pour router vers l'enrichissement
-- catalogue gratuit/ouvert (Open Food Facts -> Open Products Facts ->
-- Wikidata, voir `packages/ingestion/src/identity-source-routing.ts`)
-- AVANT tout fallback de recherche large payant.
--
-- IMPORTANT : migration committée sur la branche mais N'EST PAS appliquée
-- à la Production depuis cette session (garde-fou "Production Deploy" de
-- l'outillage — même précédent que 0017 à 0026).
-- ============================================================

alter table public.analysis_requests
  add column barcode text;

comment on column public.analysis_requests.barcode is 'Code-barres EXACT déjà normalisé côté client (GTIN natif) — jamais un identifiant deviné. LOT "Live Identity Enrichment...".';
