# ADR 0005 — Recherche : Postgres FTS d'abord, interface abstraite

**Statut** : accepté · **Date** : 2026-07-25

## Décision
Full-text search Postgres (`tsvector` généré + pg_trgm pour la tolérance aux fautes),
derrière une interface `SearchProvider` dans le code applicatif.

## Seuil de bascule
< 10M annonces actives : Postgres suffit avec les bons index.
Au-delà, ou si la pertinence devient un axe produit : Meilisearch/Typesense,
sans changement d'API applicative.
