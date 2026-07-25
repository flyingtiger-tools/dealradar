# ADR 0004 — Comparables généralistes : pgvector + attributs normalisés

**Statut** : accepté · **Date** : 2026-07-25

## Contexte
Vertical généraliste : pas d'identifiant produit fiable (pas d'EAN sur Vinted/Leboncoin).
Les comparables sont pourtant le cœur de la promesse « Know When ».

## Décision
Double approche :
1. **Attributs normalisés** (catégorie, marque, modèle, état, taille) extraits à
   l'ingestion — filtres durs.
2. **Embedding `vector(768)`** (titre + description + attributs) avec index HNSW —
   similarité sémantique pour classer les candidats.

Chaque `comparable_set` est matérialisé et daté : les scores sont auditables et rejouables.

## Conséquences
+ Fonctionne sans référentiel produit ; s'améliore avec le futur module ML
− Coût de calcul des embeddings à l'ingestion (assumé, traité en worker)
