# Politique de rétention des données opérationnelles et produit

LOT "Product History UX + Source Health + Interactive Cancellation + Beta
Readiness", section 11. Ce document décrit ce que DealRadar conserve, pour
combien de temps, et pourquoi — pour chaque table écrite par le pipeline
d'ingestion/rafraîchissement/analyse interactive.

**Aucune suppression de données Production n'a été effectuée ni automatisée
par ce lot** (garde-fou explicite du lot — même précédent que "jamais de
déploiement Production", "jamais de migration appliquée en Production").
Ce document et le code associé (`packages/ingestion/src/retention-policy.ts`)
sont des **helpers PURS de sélection** : étant donné des lignes déjà chargées
et une date de référence, ils répondent "lesquelles SERAIENT éligibles à un
nettoyage" — sans jamais lire, écrire, ni supprimer quoi que ce soit
eux-mêmes. Un futur job de nettoyage (hors scope de ce lot) consommerait ces
fonctions après avoir lui-même chargé les lignes concernées, et déciderait
lui-même d'exécuter — ou non — une suppression réelle, avec sa propre revue.

## Principe directeur

Deux familles de données, traitées différemment :

1. **Données PRODUIT** — alimentent directement une fonctionnalité visible
   par l'utilisateur (l'historique de prix, `ProductHistoryScreen`). Gardées
   longtemps ; leur perte dégraderait le produit lui-même.
2. **Logs OPÉRATIONNELS** — servent uniquement au diagnostic/à l'audit
   interne (runs de rafraîchissement, cibles traitées). Gardés pour une
   fenêtre de diagnostic raisonnable, puis sans valeur ajoutée.

Une troisième catégorie, les **requêtes annulées**, n'a de valeur ni produit
ni opérationnelle une fois leur cycle interrompu par l'utilisateur — retenue
le plus courtement.

## Tables couvertes

| Table | Colonne de référence | Rétention proposée | Famille | Pourquoi |
| --- | --- | --- | --- | --- |
| `market_observations` | `observed_at` | **Illimitée — aucune politique de suppression proposée** | Produit | Donnée centrale de l'historique de prix (voir `queryProductHistory`, `ProductHistoryScreen`) — perdre une observation ancienne appauvrit silencieusement l'historique affiché à l'utilisateur, sans bénéfice opérationnel en échange. |
| `market_snapshot_summaries` | `cycle_at` | 730 jours (2 ans) | Produit | Alimente directement `ProductHistoryScreen` (`recentSnapshotSummaries`) — 2 ans dépasse largement l'horizon de tendance affiché (180 jours max), volontairement généreux avant même d'envisager un nettoyage. |
| `listing_lifecycles` | `last_seen_at` | 365 jours (1 an) | Auditabilité | Trace la détection d'une vente (disparition d'annonce -> `confirmed_sold_at`) qui a pu alimenter `market_observations` — 1 an couvre largement tout délai de vérification/litige raisonnable sur une vente déjà persistée ailleurs. |
| `market_refresh_runs` | `created_at` | 90 jours | Log opérationnel | Audit d'un cycle de rafraîchissement en arrière-plan (LOT "Close the Refresh Loop") — utile pour diagnostiquer un incident récent, aucune valeur au-delà. |
| `market_refresh_run_targets` | `created_at` | 90 jours | Log opérationnel | Détail par cible d'un run (`market_refresh_runs`) — même durée que son parent ; supprimé en cascade si le run parent est nettoyé en premier (`on delete cascade`, migration 0024). |
| `analysis_requests` (uniquement `status = 'cancelled'`) | `updated_at` | 30 jours | Cycle interrompu | Annulée = aucune valeur produit (jamais une décision, jamais un historique affiché) — voir migration 0026/section 6-7. **Ne couvre JAMAIS** `completed`/`failed`/`insufficient_data`, qui n'ont aucune politique de rétention dans ce lot (une analyse complétée reste dans l'historique de l'utilisateur). |
| `source_health_state` | — | Aucune (état courant, 1 ligne par source) | État courant | Pas un log historique — une seule ligne par source, mise à jour en place (`upsert`), jamais accumulée dans le temps. Aucune politique de rétention nécessaire. |

### Non couvertes intentionnellement

- **`analysis_requests` avec un statut terminal autre que `cancelled`** — appartiennent à l'historique de scan de l'utilisateur (`HistoryScreen`), jamais nettoyées automatiquement par ce lot.
- **`market_products` / `research_targets`** — identité canonique et cibles de suivi actives, pas des logs d'événements ; leur cycle de vie est piloté par `enabled`/`nextRefreshAt`, pas par un âge de ligne.
- **`fx_rates`** — taux de change historiques, données publiques de faible volume, aucune pression de nettoyage identifiée à ce jour.

## Fonctions PURES (`packages/ingestion/src/retention-policy.ts`)

- `RETENTION_POLICIES` — la table ci-dessus sous forme de données typées (`table`, `timestampColumn`, `retentionDays`, `rationale`), une seule source de vérité entre ce document et le code.
- `selectRowsEligibleForCleanup(rows, policy, asOf)` — générique, fonctionne pour `market_refresh_runs`/`market_refresh_run_targets`/`listing_lifecycles`/`market_snapshot_summaries`. Une ligne dont la colonne timestamp est absente/invalide n'est **jamais** considérée éligible (repli sûr).
- `selectCancelledAnalysisRequestsEligibleForCleanup(rows, asOf)` — spécialisation pour `analysis_requests` : filtre d'abord `status === "cancelled"`, puis applique la même règle d'âge. Ne sélectionne jamais une ligne d'un autre statut, même très ancienne.

Testées dans `packages/ingestion/src/__tests__/retention-policy.test.ts` (limite stricte `<` jamais `<=`, colonnes absentes/invalides jamais éligibles, mélange de statuts pour la spécialisation `analysis_requests`).

## Ce qu'il reste à faire avant un nettoyage réel (hors scope de ce lot)

1. Écrire le job de nettoyage lui-même (SQL ou worker), qui charge les lignes, appelle les fonctions ci-dessus, et exécute la suppression — avec ses propres tests d'intégration DB.
2. Décider d'un mécanisme de planification (cron Supabase, job Railway périodique) — aucun choisi ni implémenté ici.
3. Revue de sécurité/conformité avant toute suppression réelle en Production (ce lot ne fait AUCUNE suppression, réelle ou simulée, contre une instance Supabase).
4. Réévaluer `market_observations` : ce document propose délibérément une rétention illimitée aujourd'hui ; une politique de downsampling (agrégation au-delà d'un certain âge plutôt que suppression pure) serait une décision produit distincte, pas anticipée ici.
