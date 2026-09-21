# Checklist d'activation — intelligence de marché & boucle de rafraîchissement

LOT "Close the Refresh Loop + Operational Hardening + Activation Harness".
Liste les actions humaines EXACTES nécessaires pour activer, en Production,
ce que ce lot (et les précédents) a construit — **aucune de ces actions
n'a été effectuée par ce lot** : aucune migration appliquée, aucun
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

Ajouter `--dry-run` pour voir le plan de requête (source, requête, indices)
sans appel réseau. Le script refuse automatiquement toute source verrouillée
par politique (Ricardo, PriceCharting) — voir section 4.

**À quoi ressemble un succès** : le JSON imprimé montre
`"status": "success"`, `"observationCount"` > 0 (ou 0 si la requête de test
n'a simplement aucun résultat réel — pas une erreur), `"latencyMs"`
raisonnable (< quelques secondes), aucune valeur de credential nulle part
dans la sortie. Un `"status": "error"` avec un message clair signale une
credential invalide, une source indisponible, ou un délai dépassé — jamais
un crash silencieux.

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

`summary` est un objet déterministe (`considered`, `claimed`,
`skippedLocked`, `succeeded`, `failed`, `rescheduled`,
`observationsPersisted`, `bySourceCoverage`, `elapsedMs`) — aucune
recommandation utilisateur, aucune valeur de credential.

## 9. Activation finale d'un cron Production (action humaine future, hors scope de ce lot)

Quand tout ce qui précède est vérifié : créer un job planifié Railway (ou
équivalent) qui invoque `runDueMarketRefreshBatch({ db, leaseOwner:
"<id-instance>" })` à intervalle régulier (ex. toutes les 15–30 minutes).
Le bail atomique (section 2) rend cela sûr même avec plusieurs instances
concurrentes. Ce lot ne crée délibérément PAS ce cron — c'est la dernière
étape humaine, explicite et distincte.
