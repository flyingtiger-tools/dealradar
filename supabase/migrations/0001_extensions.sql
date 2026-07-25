-- ============================================================
-- 0001 · Extensions
-- Socle technique : crypto, similarité texte, vecteurs.
-- ============================================================
create extension if not exists pgcrypto;      -- gen_random_uuid, hachage
create extension if not exists pg_trgm;       -- recherche tolérante aux fautes
create extension if not exists vector;        -- pgvector : embeddings comparables
create extension if not exists "uuid-ossp";
