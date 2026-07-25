# Architecture DealRadar

## Vue d'ensemble

```
                    ┌─────────────────────────────┐
                    │        apps/web (Next.js)    │
                    │  RSC + API routes + Realtime │
                    └────────────┬────────────────┘
                                 │  RLS (anon/user)
                    ┌────────────▼────────────────┐
                    │     Supabase / PostgreSQL    │
                    │  Auth · RLS · Realtime ·     │
                    │  Storage · pgvector · FTS    │
                    └────────────▲────────────────┘
                                 │  service role
        ┌────────────────────────┴───────────────────────┐
        │              apps/workers (Docker)              │
        │  pg-boss ─┬─ ingest    (adapters par source)    │
        │           ├─ normalize (attributs, embeddings)  │
        │           ├─ score     (deal / risk / trust)    │
        │           └─ alerts    (évaluation, notif)      │
        └─────────────────────────────────────────────────┘
```

## Flux de données

1. **Ingestion** — chaque source (Leboncoin, Vinted, eBay…) a un adapter qui implémente
   `SourceAdapter`. L'adapter produit des `RawListing` ; il ne touche jamais la base directement.
2. **Normalisation** — catégorie, marque, modèle, état, taille sont extraits dans
   `listings.attributes` (JSONB) ; un embedding `vector(768)` est calculé pour la similarité.
3. **Comparables** — recherche HNSW sur l'embedding, filtrée par catégorie/état, pour
   construire un `comparable_set` daté et auditable.
4. **Scoring** — les moteurs versionnés de `packages/core/src/scoring` produisent
   Deal/Risk/Trust ; chaque score référence le comparable_set et la version du modèle.
5. **Verdict** — la synthèse produit l'un des trois signaux produit : **Acheter / Attendre / Vendre**.
6. **Alertes** — le worker `alerts` évalue les règles utilisateur et écrit dans
   `notifications` ; le client reçoit via Supabase Realtime.

## Emplacements réservés (modules futurs)

Le schéma contient déjà les tables des modules non développés (ML, marketplace,
publication automatique, analyse des ventes). Voir `supabase/migrations/0008_*.sql`.
Leur présence fige les contrats de données et évite une migration destructrice plus tard.

## Sécurité

- RLS activée sur toutes les tables ; le rôle `anon` ne lit rien de sensible
- Écritures marché : service role uniquement (workers)
- Secrets via variables d'environnement validées par Zod (`apps/web/src/env.ts`)
- Rate limiting applicatif prévu au niveau des API routes (Lot 4, table `usage_events` prête)
- En-têtes de sécurité définis dans `next.config.mjs`

## Observabilité

- Logs structurés JSON (pino) côté workers
- `jobs`/pg-boss conservent l'historique d'exécution
- Sentry prêt à brancher via `SENTRY_DSN`
