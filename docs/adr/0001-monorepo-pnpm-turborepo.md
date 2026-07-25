# ADR 0001 — Monorepo pnpm workspaces + Turborepo

**Statut** : accepté · **Date** : 2026-07-25

## Contexte
Le domaine (types, validation, moteurs de score) est partagé entre le frontend Next.js
et les workers d'ingestion. Deux dépôts créeraient une dérive de contrats immédiate.

## Décision
Monorepo pnpm workspaces, orchestré par Turborepo (cache de builds, pipelines).

## Conséquences
+ Un seul contrat de données (`@dealradar/core`) consommé partout
+ CI incrémentale, refactorings atomiques
− Discipline requise sur les frontières de packages (imposée par ESLint plus tard)
