# ADR 0002 — Supabase / PostgreSQL comme socle

**Statut** : accepté · **Date** : 2026-07-25

## Contexte
Besoin : auth, base relationnelle, temps réel, stockage fichiers, et une porte de
sortie sans réécriture (souveraineté suisse possible : Infomaniak / on-premise).

## Décision
Supabase (PostgreSQL 15) : Auth, RLS, Realtime, Storage, pgvector.
Tout le schéma vit dans des migrations SQL versionnées — jamais dans le dashboard.

## Alternatives rejetées
- **Firebase** : NoSQL inadapté aux comparables/historiques, lock-in Google fort
- **Postgres nu + Auth maison** : coût de sécurité inutile à ce stade

## Conséquences
+ RLS = autorisation au plus près des données
+ Auto-hébergeable (exit strategy documentée)
− Realtime Supabase à surveiller en charge ; abstraction prévue si besoin
