# Checklist d'activation — intelligence de marché & boucle de rafraîchissement

LOTs "Close the Refresh Loop + Operational Hardening + Activation Harness"
et "Real DB Integration + Exact Budget Enforcement + Runtime Observability".
Liste les actions humaines EXACTES nécessaires pour activer, en Production,
ce que ces lots (et les précédents) ont construit — **aucune de ces actions
n'a été effectuée par ces lots** : aucune migration appliquée, aucun
scheduler/cron créé, aucune credential réelle configurée. Toutes restent
un choix humain délibéré et distinct. Ce document ne contient **aucune
valeur de credential**, uniquement des noms de variable d'environnement.

## 1. Migrations requises, dans l'ordre

Toutes committées sur `feat/reprise-ai-ingestion-foundation`, **aucune
appliquée à la Production par ce lot ou les précédents**. À appliquer via
Supabase CLI/dashboard, dans cet ordre exact (chacune dépend de la
précédente) :

| # | Fichier | Contenu |
| --- | --- | --- |
| 0017 | `0017_analysis_requests_category_slug_expand.sql` | Élargit `category_slug` sur `analysis_requests`. |
| 0018 | `0018_market_observations.sql` | Table `market_observations` — observations brutes multi-source. |
| 0019 | `0019_market_products.sql` | `market_products` + `market_product_identifiers` — identité produit canonique. |
| 0020 | `0020_research_targets.sql` | `research_targets` — cibles de suivi longitudinal. |
| 0021 | `0021_research_targets_lease.sql` | Bail/claim atomique (`claim_research_target`/`release_research_target`) — **prérequis pour activer un scheduler sans double-traitement**. |
| 0022 | `0022_listing_lifecycles.sql` | `listing_lifecycles` — cycle de vie d'annonces, sans vente fabriquée. |
| 0023 | `0023_market_snapshot_summaries.sql` | `market_snapshot_summaries` — résumés compacts par cycle. |
| 0024 | `0024_market_refresh_run_audit.sql` | `market_refresh_runs` + `market_refresh_run_targets` — audit durable des runs/cibles de rafraîchissement. |

**Vérification après application** : `select count(*) from public.research_targets;`
doit retourner `0` (table vide, vierge) et
`select proname from pg_proc where proname in ('claim_research_target','release_research_target');`
doit retourner les deux noms de fonction.

## 2. Plan Railway requis

Le worker qui exécuterait `runDueMarketRefreshBatch()` (voir section 5) a
besoin d'un processus long-vivant ou d'un cron Railway — **aucun des deux
n'est configuré par ce lot** (interdiction explicite, section 14). Le plan
Railway actuel doit supporter :
- un service worker additionnel (ou une extension du service existant) ;
- suffisamment de minutes de calcul pour un batch borné (`totalRunTimeoutMs`,
  défaut 5 minutes par run) exécuté à la fréquence choisie ;
- pas d'exigence réseau sortante particulière au-delà de ce que les
  connecteurs existants utilisent déjà (eBay, SerpApi, DataForSEO, BrickLink,
  Keepa, Frankfurter).

Vérifier le plan/quota actuel dans le dashboard Railway avant d'activer un
cron — ce lot ne peut pas le vérifier depuis cet environnement.

## 3. Préparation fournisseur IA (OpenAI/Anthropic)

Le rafraîchissement de cibles (`runDueMarketRefreshBatch`) **n'appelle
aucun fournisseur IA** — il opère uniquement sur des identités déjà
connues et des connecteurs de marché déterministes. Un fournisseur IA
n'est nécessaire QUE pour le chemin d'analyse interactif existant
(`process-analysis.ts`), déjà en place et non modifié par ce lot. Variables
concernées (présence uniquement, jamais une valeur) :
`AI_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`,
`OPENROUTER_API_KEY`, `AI_MODEL`, `AI_MAX_IMAGES`, `AI_DAILY_BUDGET_USD`.
Aucune action requise ici spécifiquement pour ce lot.

## 4. Noms de variables d'environnement par source

Aucune valeur ci-dessous — uniquement les NOMS à provisionner. Statut de
politique tiré de `packages/connectors/src/market-intelligence/source-
readiness-matrix.ts` (source de vérité unique, jamais dupliquée ailleurs).

| Source | Variables requises | Statut de politique | `productionAllowed` |
| --- | --- | --- | --- |
| eBay | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_MARKETPLACE_ID`, `EBAY_ENVIRONMENT` | missing_credentials → ready dès que posées | oui |
| Google Shopping (SerpApi) | `SERPAPI_KEY` | missing_credentials → ready | oui |
| Google Shopping (DataForSEO) | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (+ `DATAFORSEO_LOCATION_CODE` optionnel) | missing_credentials → ready | oui |
| BrickLink | `BRICKLINK_CONSUMER_KEY`, `BRICKLINK_CONSUMER_SECRET`, `BRICKLINK_TOKEN_VALUE`, `BRICKLINK_TOKEN_SECRET` | missing_credentials → ready | oui |
| Keepa | `KEEPA_API_KEY` | missing_credentials → ready | oui |
| Frankfurter (FX) | *(aucune)* | toujours ready | oui |
| PriceCharting | `PRICECHARTING_TOKEN` | **license_required — verrouillé par POLITIQUE, la credential seule ne l'active jamais** | **non** |
| Ricardo | `ZYTE_API_KEY` (fournisseur de scraping générique) | **restricted — verrouillé par POLITIQUE** | **non** |
| Tutti / Anibis | *(aucune, jamais implémentées)* | disabled_policy (mur CAPTCHA) | non |
| TCGplayer / StockX / WatchCharts | voir la matrice | restricted / license_required | non |

**Rappel du changement de comportement de ce lot (section 6)** : poser
`PRICECHARTING_TOKEN` ou `ZYTE_API_KEY` ne suffit PLUS à faire construire
ces deux sources par `buildMarketSourcesFromEnv` — un changement de
`policyStatus`/`productionAllowed` dans `source-readiness-matrix.ts` est
requis en plus, et reste un choix produit distinct, jamais fait par ce lot.

## 5. Test de fumée par source (avant toute activation Production)

Pour CHAQUE source `productionAllowed: true` avant de compter sur elle en
Production :

```bash
pnpm --filter @dealradar/workers smoke-test -- --source ebay --category lego --field bricklinkNo=10300
pnpm --filter @dealradar/workers smoke-test -- --source bricklink --category lego --field bricklinkNo=10300
pnpm --filter @dealradar/workers smoke-test -- --source keepa --category apple --field asin=B0XXXXXX
pnpm --filter @dealradar/workers smoke-test -- --source google_shopping --category apple --field brand=Apple --field model="iPhone 13"
pnpm --filter @dealradar/workers smoke-test -- --source dataforseo_google_shopping --category apple --field brand=Apple --field model="iPhone 13"
```

Ajouter `--dry-run` pour voir le `SourceSelectionPlan` complet (politique,
credentials, identité, budget) ET le plan de requête sans appel réseau.
`--currency <devise>` déclare la devise cible attendue (le script ne
convertit jamais lui-même — signale simplement si rien n'est disponible
dans cette devise). `--timeout-ms <ms>` surcharge le délai réseau borné
(défaut 15000). Le script refuse automatiquement toute source verrouillée
par politique (Ricardo, PriceCharting) — voir section 4.

**Codes de sortie déterministes** (LOT "Real DB Integration...", section 11) :

| Code | Signification |
| --- | --- |
| 0 | Succès |
| 2 | Credentials manquantes |
| 3 | Verrouillé par politique |
| 4 | Aucun plan de requête pour cette source/ces champs |
| 5 | Panne réseau/fournisseur |
| 6 | Aucune observation utilisable |
| 7 | Bloqué par le change (devise demandée absente) |
| 1 | Erreur générique (arguments invalides, etc.) |

**À quoi ressemble un succès** : code de sortie `0`, le JSON imprimé montre
`"status": "success"`, `"observationCount"` > 0 (ou 0 avec le code 6 si la
requête de test n'a simplement aucun résultat réel — pas une erreur),
`"latencyMs"` raisonnable (< quelques secondes), aucune valeur de credential
nulle part dans la sortie.

## 6. Rollback / interrupteur de désactivation

- **Par source** : retirer la variable d'environnement correspondante
  (section 4) — `buildMarketSourcesFromEnv` exclut alors cette source
  proprement, sans redéploiement de code, sans erreur pour les autres.
- **Verrou de politique permanent** : changer `policyStatus`/
  `productionAllowed` dans `source-readiness-matrix.ts` — c'est la SEULE
  façon de désactiver une source définitivement, jamais une variable
  d'environnement seule (délibéré, voir section 6 du lot).
- **Boucle de rafraîchissement entière** : ne JAMAIS invoquer
  `runDueMarketRefreshBatch()` depuis un scheduler — tant qu'aucun cron
  n'existe (état actuel, section 14), la boucle reste inerte par
  construction, aucun interrupteur supplémentaire n'est nécessaire.
- **Un run déjà en cours** : aucun mécanisme d'arrêt en cours de route
  n'existe encore (hors du délai `totalRunTimeoutMs`) — NOT TESTED, voir
  BUILDER HANDOFF pour les tâches suivantes.

## 7. Vérifier qu'aucune source n'est accidentellement "vente-capable"

Aucune source de ce lot ni des précédents ne peut aujourd'hui définir
`confirmedSoldAt`/`confirmed_sold_at` autrement qu'à partir d'une
confirmation EXPLICITE fournie par le connecteur lui-même (jamais déduit
d'une disparition — voir `packages/core/src/intelligence/listing-
lifecycle.ts`, section 9 de ce lot). Vérification :

```bash
grep -rn "confirmedSoldAt\s*:" packages/connectors/src --include="*.ts" | grep -v "null"
```

Ne doit renvoyer AUCUN résultat en dehors des définitions de type — si un
futur connecteur en ajoute un, il doit provenir d'un champ structuré de
vente réellement confirmée par la source, jamais d'un texte de titre ni
d'une absence d'annonce.

## 8. Vérifier la boucle de rafraîchissement SANS activer de cron

La boucle est entièrement testable localement — aucune Production requise :

```bash
pnpm --filter @dealradar/workers test -- refresh-due-research-targets
```

Pour un essai manuel contre une base LOCALE/DEV (jamais Production) une fois
les migrations 0017–0023 appliquées à cet environnement :

```ts
import { runDueMarketRefreshBatch } from "./src/jobs/refresh-due-research-targets";
const summary = await runDueMarketRefreshBatch({ db: supabaseClient, leaseOwner: "manual-test-1" });
console.log(summary);
```

`summary` est un objet déterministe (`runKey`, `considered`, `claimed`,
`skippedLocked`, `succeeded`, `failed`, `rescheduled`,
`observationsPersisted`, `bySourceCoverage`, `elapsedMs`, `timedOut`,
`budgetExhausted`) — aucune recommandation utilisateur, aucune valeur de
credential. Chaque run est aussi persisté durablement dans
`market_refresh_runs`/`market_refresh_run_targets` (section 10) dès que les
migrations sont appliquées.

## 9. Activation finale d'un cron Production (action humaine future, hors scope de ces lots)

Quand tout ce qui précède est vérifié : créer un job planifié Railway (ou
équivalent) qui invoque `runDueMarketRefreshBatch({ db, leaseOwner:
"<id-instance>" })` à intervalle régulier (ex. toutes les 15–30 minutes).
Le bail atomique (section 2) rend cela sûr même avec plusieurs instances
concurrentes. Ces lots ne créent délibérément PAS ce cron — c'est la
dernière étape humaine, explicite et distincte.

## 10. Audit durable des runs (`market_refresh_runs`/`market_refresh_run_targets`)

Chaque appel de `runDueMarketRefreshBatch()` persiste, en fin de run,
UNIQUEMENT des métadonnées sûres (compteurs, noms de source, classes de
raison — jamais un secret ni un payload brut complet) :

- `market_refresh_runs` : une ligne PAR RUN (`run_key` unique — idempotent
  si rejoué), avec `considered`/`claimed`/`succeeded`/`failed`,
  `target_counts_by_outcome`/`source_counts_by_status`/`error_class_counts`
  (bags JSON ouverts), `timed_out`/`budget_exhausted`.
- `market_refresh_run_targets` : une ligne PAR CIBLE traitée dans ce run
  (`selected_sources`, `skipped_source_reasons`, `fx_skipped_count`,
  `identity_conflict_count`, `safe_error_class`).

Une panne de CETTE persistance n'interrompt jamais le lot lui-même — voir
`packages/ingestion/src/persist-refresh-run-audit.ts`, appelé dans son
propre `try/catch` par le runner.

Requête de vérification après un run manuel (section 8) :

```sql
select run_key, considered, claimed, succeeded, failed, timed_out, budget_exhausted
from public.market_refresh_runs order by started_at desc limit 5;

select product_key, outcome, failure_reason, selected_sources, fx_skipped_count
from public.market_refresh_run_targets
where run_id = (select id from public.market_refresh_runs order by started_at desc limit 1);
```

## 11. Harnais d'intégration DB réelle (jamais exécuté sans opt-in explicite)

Un harnais de test (`packages/ingestion/src/__tests__/db-integration/`)
prouve l'atomicité RÉELLE du bail (`claim_research_target`/
`release_research_target`, migration 0021) contre une VRAIE Postgres —
distinct des tests unitaires habituels (qui simulent la logique SQL en
mémoire, sans jamais prouver le comportement `FOR UPDATE SKIP LOCKED`
propre à Postgres).

**Jamais activé par défaut.** Trois garde-fous cumulatifs :

1. `ALLOW_DB_INTEGRATION_TESTS=true` posé explicitement ;
2. trois variables `TEST_DATABASE_URL` (connexion Postgres brute, pour
   appliquer les migrations), `TEST_DATABASE_SUPABASE_URL` et
   `TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY` (client applicatif, même
   chemin RPC que la Production) — des noms DISTINCTS des variables
   Production (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`DATABASE_URL`) ;
3. une vérification d'égalité automatique refuse l'exécution si l'une de
   ces variables coïncide, par accident, avec une variable Production
   présente dans le même environnement.

```bash
ALLOW_DB_INTEGRATION_TESTS=true \
TEST_DATABASE_URL="postgresql://postgres:<mot-de-passe>@<host>:5432/postgres" \
TEST_DATABASE_SUPABASE_URL="https://<projet-jetable>.supabase.co" \
TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY="<clé service role du projet JETABLE>" \
pnpm --filter @dealradar/ingestion test -- claim-research-target.db.test.ts
```

Le harnais applique lui-même les migrations 0001→0023 sur la base jetable
(idempotent : si `research_targets` existe déjà, ne rejoue rien) et
nettoie ses propres lignes de test après exécution (préfixe
`db-integration-test:`, jamais un `TRUNCATE` aveugle). **Sans ces
variables, la suite entière est marquée SKIPPED — jamais un succès
fabriqué.**

## 12. Séquence non-Production par étapes (Stage A→E)

Ordre exact, avec critère de réussite/échec explicite à chaque étape —
**aucune étape ne passe à la suivante sans que la précédente réussisse**.
Aucune activation Production dans cette séquence.

**Stage A — Migrations + intégration DB réelle**
- Appliquer les migrations 0017→0024 (section 1) sur une base jetable/non-prod.
- Lancer le harnais d'intégration DB (section 11).
- **Réussite** : les 5 tests `claim-research-target.db.test.ts` passent
  (jamais SKIPPED — un skip ici signifie que les variables n'étaient pas
  posées, pas une réussite). **Échec** : toute assertion de double-réclamation
  ou de vol de bail actif échoue — ne pas continuer avant investigation.

**Stage B — Tests de fumée par source, un par un**
- Exécuter la commande de la section 5 pour CHAQUE source `productionAllowed: true`.
- **Réussite** : code de sortie `0` ou `6` (aucune observation, pas une
  erreur) pour chaque source testée. **Échec** : code `2`/`3`/`5` — ne pas
  activer cette source tant que la cause n'est pas résolue.

**Stage C — Un `runDueMarketRefreshBatch` manuel**
- Exécuter l'essai manuel de la section 8 contre la base non-prod (avec au
  moins une `research_target` de test réellement seedée).
- **Réussite** : `summary.timedOut === false`, `summary.claimed >= 1` si
  une cible était due, `summary.perTarget` cohérent avec les sources
  testées en Stage B. **Échec** : une exception non catchée remonte, ou
  `claimed > considered` (incohérence de comptage) — ne pas continuer.

**Stage D — Inspecter les lignes d'audit**
- Exécuter les requêtes SQL de la section 10 contre la base non-prod.
- **Réussite** : une ligne `market_refresh_runs` correspond exactement au
  `runKey` retourné par le Stage C, et `market_refresh_run_targets` contient
  autant de lignes que `summary.claimed`. **Échec** : lignes manquantes ou
  incohérentes avec le résumé en mémoire.

**Stage E — Seulement après A→D réussis : envisager un scheduler**
- Ce n'est qu'à ce stade qu'un déploiement de cron Production (section 9)
  devient une décision humaine raisonnable — jamais avant, jamais par ce
  lot lui-même.

## Observabilité opérateur (LOT "Data Quality Calibration + Operator
Observability + Mobile Market Insight Contract")

Avant/pendant les Stages A→E ci-dessus, `getOperatorObservabilitySummary`
(`packages/ingestion/src/operator-observability.ts`) et
`checkHistoricalEngineAvailability` (`check-historical-engine-availability.ts`)
donnent une vue en LECTURE SEULE, sans SQL brut : derniers runs et taux de
réussite, cibles en échec par raison, erreurs/timeouts par source, cibles
dues/en retard, runs à budget épuisé, runs expirés, volume d'observations
persistées dans le temps, produits avec conflit d'identité non résolu. Voir
`docs/market-valuation-quality.md` (section 8) pour le détail complet des
champs retournés et la garantie "aucun secret, aucune URL brute".

Le mobile (Internal Tools) consulte cette même vue via
`GET /api/internal/operator/observability` (`apps/web`) — voir
`apps/mobile/src/screens/internal/OperatorDiagnosticsScreen.tsx`.

## 13. Rapport de préflight d'activation (LOT "Interactive History +
Generic Result UI + Full Cancellation + Pre-Prod Activation Package",
section 11)

`pnpm --filter @dealradar/workers activation-preflight` — rapport JSON
BORNÉ, EN LECTURE SEULE, sans Railway/le worker en ligne (uniquement des
lectures Supabase directes + des vérifications d'environnement pur) :
migrations 0017–0024 présentes, préparation par source (politique +
présence de credentials — reflète `buildMarketSourcesFromEnv().diagnostics`,
même logique que le test de fumée section 5), provider IA configuré,
variables d'intégration DB réelle configurées, nombre de cibles dues.
Statut `READY`/`BLOCKED`/`PARTIAL` par sous-système et global — jamais une
décision automatique, seulement un instantané à relire avant d'envisager
le Stage E ci-dessus. Voir `apps/workers/src/scripts/activation-preflight.ts`.
