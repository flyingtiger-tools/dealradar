# ADR 0006 — Moteurs de score versionnés et déterministes

**Statut** : accepté · **Date** : 2026-07-25

## Contexte
Deal Score, Risk Score et Trust Score sont la proposition de valeur. Un score qui
change sans explication détruit la confiance — l'inverse exact de la mission.

## Décision
- Chaque moteur vit dans `packages/core/src/scoring`, fonction pure : (entrées, comparables) → score
- Chaque résultat persiste `engine_version` + référence au `comparable_set`
- Toute évolution de formule = nouvelle version, jamais une modification silencieuse
- Le futur module ML produira des `ml_predictions` distinctes, comparées aux moteurs
  heuristiques avant toute promotion (shadow scoring)
