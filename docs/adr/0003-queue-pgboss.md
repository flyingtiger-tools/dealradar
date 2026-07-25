# ADR 0003 — File de jobs : pg-boss sur PostgreSQL

**Statut** : accepté · **Date** : 2026-07-25

## Contexte
Ingestion, scoring, alertes et tâches planifiées exigent une file fiable
(retry, cron, archivage). L'équipe est petite ; chaque brique d'infra a un coût.

## Décision
pg-boss (schéma `pgboss` dédié). Les contrats de jobs sont typés dans
`apps/workers/src/queues.ts` ; les handlers ignorent l'implémentation de la file.

## Conséquences
+ Zéro infra additionnelle, transactions partagées avec les données
+ Migration BullMQ/Redis possible en réécrivant uniquement le bootstrap
− Au-delà de ~quelques milliers de jobs/s, migration nécessaire (seuil documenté)
