# DealRadar — Know When.

Plateforme d'avantage informationnel sur le marché de la seconde main.
Nous ne comparons pas des prix. Nous disons **quand acheter, quand attendre, quand vendre**.

## Monorepo

```
dealradar/
├── apps/
│   ├── web/          # Next.js 15 (App Router) — frontend + API routes
│   └── workers/      # Workers Node (Docker) — ingestion, scoring, alertes
├── packages/
│   ├── core/         # Domaine partagé : types, validation Zod, moteurs de score
│   └── config/       # tsconfig de base partagé
├── supabase/
│   └── migrations/   # Schéma PostgreSQL versionné (source de vérité)
├── docs/
│   ├── ARCHITECTURE.md
│   └── adr/          # Architecture Decision Records
├── docker/           # Dockerfiles web + worker, docker-compose
└── .github/workflows # CI (lint, typecheck, build)
```

## Démarrage

```bash
corepack enable                 # active pnpm
pnpm install
cp .env.example .env.local      # puis remplir les valeurs Supabase
npx supabase start              # Postgres local + applique les migrations
pnpm dev                        # web sur :3000
```

Workers (nécessite DATABASE_URL) :

```bash
pnpm --filter @dealradar/workers dev
```

## Choix d'architecture (résumé — détails dans docs/adr/)

| Décision | Choix | Pourquoi |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Un domaine partagé (`core`) entre web et workers, builds incrémentaux |
| Frontend | Next.js 15 / React 19 / Tailwind | RSC pour la perf, écosystème mature 10 ans |
| Base | Supabase (PostgreSQL 15) | Auth + RLS + Realtime + Storage intégrés ; **auto-hébergeable** (exit possible vers Infomaniak/on-prem) |
| Comparables | pgvector (HNSW) + attributs normalisés | Vertical généraliste ⇒ pas d'identifiant produit fiable ⇒ similarité sémantique |
| Files d'attente | pg-boss sur PostgreSQL | Zéro infra additionnelle au départ ; contrats de jobs typés ⇒ migration BullMQ/Redis sans toucher au métier |
| Scrapers | Workers Docker isolés, 1 adapter/source | Risque juridique et de maintenance confiné hors du cœur |
| Recherche | Postgres FTS + pg_trgm derrière une interface | Suffisant < 10M annonces ; bascule Meilisearch prévue |
| Scores | Moteurs versionnés dans `core` | Deal/Risk/Trust auditables, rejouables, testables |

## Feuille de route

- **Lot 1 (ce dépôt)** : fondations — monorepo, schéma complet, design system, auth, shell applicatif, workers squelette
- **Lot 2** : pages fonctionnelles (recherche, watchlists, alertes, portfolio) branchées sur Supabase
- **Lot 3** : pipeline d'ingestion, comparables, historique prix, moteurs de score
- **Lot 4** : Stripe, quotas, admin, monitoring, durcissement production

## Conventions

- TypeScript strict partout, aucun `any` non justifié
- Validation Zod à chaque frontière (env, API, jobs)
- Écritures marché uniquement via workers (service role) ; le client web est en lecture RLS
- Migrations SQL immuables : on ajoute, on ne réécrit jamais
- Commits conventionnels (`feat:`, `fix:`, `chore:`…)
