# Benchmark — mesure, profiling, non-régression (Lot 6)

`packages/benchmark` transforme le pipeline `eBay → normalisation →
extraction → Intelligence Core` en système mesuré. Il ne construit aucune
fonctionnalité produit : il mesure, profile, et sert de garde-fou de
non-régression pour tout travail futur sur `packages/ai`/`packages/core`.

## Lancer un benchmark

```bash
# Depuis packages/benchmark, ou via pnpm --filter @dealradar/benchmark bench --
pnpm bench -- --dataset=lego,apple            # datasets spécifiques
pnpm bench -- --dataset=all                   # les 5 catégories
pnpm bench -- --provider=openai               # nécessite OPENAI_API_KEY dans l'environnement
pnpm bench -- --save-baseline                 # écrase la baseline (geste explicite)
```

Sans `OPENAI_API_KEY`, `--provider=openai` retombe automatiquement sur le
provider simulé (jamais de clé fabriquée). Par défaut (`--provider` omis),
le provider **simulé** est utilisé : il ne cherche jamais à deviner mieux
que l'extraction déterministe — il retourne un JSON vide après une latence
artificielle, uniquement pour exercer le chemin de code (cache, agrégation,
rapport). **Toute métrique de latence/coût issue du provider simulé est
illustrative, jamais une mesure de qualité IA réelle.**

Chaque run écrit un rapport HTML autonome dans
`packages/benchmark/reports/<horodatage>/index.html` (dossier gitignored)
et affiche un résumé en console. Code de sortie non-nul si une régression
de qualité est détectée (voir plus bas) — utile en CI.

## Mode `--online` (Supabase réel) — jamais automatique

```bash
pnpm bench -- --dataset=lego --online     # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY requis
pnpm bench -- --cleanup-only              # nettoyage manuel de rattrapage
```

- **Jamais déclenché sans le flag explicite `--online`.**
- Exécute la pipeline d'ingestion réelle et inchangée
  (`persistListing`/`extractListing`/`analyzeListing`, `@dealradar/ingestion`)
  contre le projet Supabase configuré, sous une source `sources.slug =
  "benchmark"` **dédiée et isolée** (`is_active: false`, jamais utilisée par
  un connecteur réel). Le pool de comparables du dataset est persisté comme
  des annonces déjà vendues (`status: "sold"`) pour exercer Intelligence
  Core au-delà de `INSUFFICIENT_DATA`.
- **Nettoyage automatique en fin de run, y compris en cas d'erreur**
  (`try/finally` dans `cli.ts`) : toutes les annonces sous la source
  `benchmark` sont supprimées (cascade vers `listing_media`,
  `price_observations`, `intelligence_results`), et les entrées de
  `ai_extraction_cache` créées pendant la fenêtre du run sont purgées.
- **Limite assumée** : le cache IA est nettoyé par fenêtre temporelle
  (`created_at >= début du run`), pas par clé individuellement tracée —
  ne jamais lancer `--online` en parallèle d'un worker de production réel
  sur le même projet Supabase. Si le process est interrompu brutalement
  (`SIGKILL`) avant le `finally`, des lignes peuvent rester : relancer
  `--cleanup-only` pour rattraper, ou vérifier manuellement `select * from
  listings where source_id = (select id from sources where slug =
  'benchmark')`.
- Ce lot ne budgétise pas les appels IA en ligne (pas de `BudgetGuard`
  câblé) — aucune ligne n'est donc créée dans `ai_usage_log`.

## Ajouter un dataset

Un dataset est un fichier JSON dans `packages/benchmark/datasets/`, validé
par `src/dataset/schema.ts` :

```json
{
  "categorySlug": "lego",
  "provenance": "synthetic",
  "items": [
    { "raw": { "itemId": "...", "title": "...", "price": { "value": "849.99", "currency": "CHF" } },
      "expected": { "sufficientDeterministic": true, "condition": "new" } }
  ],
  "comparables": [
    { "raw": { "itemId": "...", "title": "...", "price": { "value": "800.00", "currency": "CHF" } },
      "soldAt": "2026-06-01T00:00:00.000Z" }
  ]
}
```

- **`raw`** doit rester dans le sous-ensemble exact d'`EbayRawItem`
  (`packages/connectors/src/ebay/raw-types.ts`) — `itemId`, `title`,
  `shortDescription`/`description`, `price`, `image`/`additionalImages`,
  `condition`, `seller`, `itemLocation`, `shippingOptions`, `categories`,
  `itemCreationDate`, `localizedAspects`. **N'invente jamais un champ hors
  de ce sous-ensemble.**
- **`expected`** est une annotation du benchmark, jamais un champ Browse
  API réel — sert uniquement à mesurer la précision d'identification.
  Absente = pas de vérification de précision pour cette entrée.
- **`comparables[].soldAt`** est également une annotation du benchmark (la
  Browse API ne restitue pas les ventes conclues, cf. ADR 0008) — sert
  uniquement à exercer Intelligence Core au-delà d'`INSUFFICIENT_DATA` sur
  ce dataset synthétique.
- **`provenance`** : `"synthetic"` pour tout dataset fabriqué (ce lot),
  `"real"` réservé à un futur export réel de l'API Browse.

### Remplacer par un export réel

Convertir un export réel de l'API Browse (`item_summary/search` ou
`item/{item_id}`) en dataset = envelopper chaque item dans `{ "raw": <item
tel quel> }` et passer `"provenance": "real"`. **Aucun changement de code
n'est nécessaire** : `normalizeEbayItem()` (le connecteur réel, inchangé)
consomme directement cette forme.

## Lire un rapport

- **"Cohérence sur dataset synthétique"** vs **"Performance sur dataset
  réel"** : la précision d'un dataset `synthetic` ne représente jamais une
  performance produit réelle — seul un dataset `provenance: "real"`
  autorise le second libellé. **Un rapport ne mélange jamais l'agrégation
  de deux provenances différentes** (`combineAggregates` lève une erreur
  explicite si on essaie).
- **Temps par phase** : total, extraction (dont cache, dont IA), mapping
  (normalisation eBay + fusion des attributs), Intelligence Core. Le temps
  DB n'apparaît qu'en mode `--online`, clairement étiqueté "en ligne".
- **Annonces à examiner** : annonces eBay inutilisables, précision annotée
  incorrecte, ou contradiction majeure/extraction invalide — jamais
  `INSUFFICIENT_DATA` seul (c'est souvent le comportement correct, pas un
  problème).

## Non-régression

`baseline/<categorie>.json` (committé) ne compare que **4 métriques de
qualité**, jamais la latence/coût/cache hit :

- précision annotée
- taux d'extraction invalide (`INVALID_PROVIDER_RESPONSE`)
- taux de contradiction majeure (`MAJOR_CONTRADICTION`)
- taux `INSUFFICIENT_DATA`

Ce choix est délibéré : latence, coût et taux de cache hit dépendent du
provider (simulé ou réel) et de l'environnement d'exécution, pas de la
qualité du code — les comparer ferait échouer le CI pour de mauvaises
raisons tant qu'aucun provider/base réels ne sont utilisés.

`--save-baseline` écrase la baseline — geste explicite, jamais automatique.
Sans baseline (premier run), la comparaison passe toujours (rien à
comparer).

## Ajouter un provider réel

`buildProvider()` (`cli.ts`) ne connaît que deux valeurs pour
`--provider` : `simulated` (défaut) et `openai` (réutilise
`createOpenAiProvider` de `@dealradar/ai`, inchangé). Pour un futur
provider (Anthropic, etc.), suivre la procédure de l'ADR 0009 — aucun
changement necessaire dans `packages/benchmark` au-delà d'un nouveau cas
dans `buildProvider()`.
