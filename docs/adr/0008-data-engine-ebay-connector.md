# ADR 0008 — Data Engine V1 et connecteur eBay

**Statut** : accepté · **Date** : 2026-07-26

## Contexte

Intelligence Core (ADR 0007) est un moteur pur, sans aucune source de
données réelle. Ce lot construit la couche d'ingestion multi-source et
branche un premier connecteur réel : eBay, en lecture seule, API officielles
uniquement.

## Pourquoi eBay en premier

Marketplace généraliste couvrant les 5 catégories supportées (LEGO,
Pokémon/TCG, Apple, Gaming, Photo), API REST officielles modernes (Buy
Browse API) avec authentification OAuth client credentials standard —
contrairement à des marketplaces régionales plus fermées, le point d'entrée
technique est documenté et accessible sans partenariat spécial.

## Annonces actives vs ventes conclues — limite structurelle

Vérification de la documentation officielle eBay avant tout code (exigence
du lot) :

- Le **Finding API** (dont `findCompletedItems`, qui donnait des prix de
  ventes conclues) est déprécié et décommissionné (fin de vie février 2025).
- Le remplaçant officiel, la **Marketplace Insights API**, est **réservé
  aux partenaires approuvés** — un compte développeur standard (OAuth
  client credentials) n'y a pas accès. Confirmé par des rapports de la
  communauté développeurs eBay de décembre 2025.
- Le **Sell API** ne donne que les ventes du propre compte vendeur de
  l'appelant — inutilisable comme source de comparables de marché.

Sources : [Marketplace Insights API access](https://community.ebay.com/t5/eBay-APIs-Talk-to-your-fellow/Access-to-sold-completed-listing-data-what-options-do-non/m-p/35398955), [Finding API deprecation](https://forums.developer.ebay.com/questions/40111/findcompleteditems-api-is-deprecatedfindcompletedi.html), [Finding/Shopping API decommission](https://community.ebay.com/t5/Traditional-APIs-Search/Alert-Finding-API-and-Shopping-API-to-be-decommissioned-in-2025/td-p/34222062).

**Conséquence** : le connecteur eBay déclare `capabilities: ["search",
"itemDetails"]` — **jamais `soldPrices`**. `runIntelligencePipeline` ne
reçoit donc jamais de comparables vendus en provenance d'eBay ; il retourne
`INSUFFICIENT_DATA` par son propre fonctionnement existant (ADR 0007), sans
qu'aucun code de ce lot n'ait besoin de le forcer. Aucune annonce active
n'est jamais présentée comme une vente conclue ; aucun prix n'est inventé.

## Architecture des paquets

- **`packages/connectors`** — interface `MarketplaceConnector` (source,
  capabilities, `search()`, `getItem()`, `healthCheck()`) + implémentation
  eBay. Zéro dépendance Supabase, entièrement mockable.
- **`packages/ingestion`** — orchestration DB-aware (persistance, run
  d'ingestion, appel à Intelligence Core). Dépend de `@dealradar/core` +
  `@dealradar/connectors`, jamais l'inverse.
- **`packages/core` reste sans aucune dépendance à eBay** (vérifié :
  `grep -r "ebay" packages/core/src` ne retourne rien). Le mapping entre le
  format riche du connecteur et le `NormalizedListing` du pipeline se fait
  exclusivement dans `packages/ingestion/src/map-to-intelligence.ts`.

## Normalisation

`packages/connectors/src/ebay/normalize.ts` : un item sans identifiant,
titre ou prix exploitable retourne `null` (jamais de valeur inventée). La
condition eBay est mappée vers `new/like_new/very_good/good/fair/for_parts`
via une table volontairement incomplète — un libellé non reconnu devient
`null`, jamais une supposition. Les aspects (`localizedAspects`) sont repris
tels quels dans `attributes`, **sans** tentative de correspondance avec les
clés attendues par les profils de catégorie (ex. `setNumber`) : cette
correspondance nécessiterait une vérification avec des identifiants eBay
réels, non disponibles pour ce lot — limite assumée. En pratique, tant que
ce mapping n'existe pas, l'identification produit restera pauvre et la
confiance basse, ce qui est le comportement *sûr* par défaut (jamais de
fausse précision).

## Déduplication et persistance

- Contrainte déjà existante `unique(source_id, external_id)` sur `listings`
  (migration 0004) : `persist-listing.ts` fait un upsert idempotent dessus.
- `price_observations` (déjà existante) n'est alimentée que si le prix
  change réellement — un rerun identique ne crée aucune ligne supplémentaire.
- Le slug de catégorie Intelligence Core (lego/pokemon_tcg/apple/gaming/
  photo) est stocké dans `listings.attributes.categorySlug`, pas dans
  `listings.category_id` : la table `categories` (taxonomie générale du
  marché) est un chantier distinct, non peuplé dans ce lot. Limite
  documentée, sans impact sur la validité du pipeline.

## Sélection des comparables — durcissement

`analyze-listing.ts` ne filtre jamais sur la seule catégorie. Le
pré-filtrage DB exige : catégorie, devise, condition, **et** correspondance
exacte sur les attributs d'identité requis par le profil résolu (ex. même
`setNumber`). Sans correspondance suffisante : zéro candidat transmis,
`INSUFFICIENT_DATA`. Testé explicitement (`analyze-listing.test.ts`) :
un produit différent de la même catégorie n'est jamais retenu.

## Déclenchement depuis apps/web — compromis retenu

La convention Lot 1 (« écritures marché uniquement via workers ») est
respectée à la lettre : apps/web n'exécute jamais le connecteur ni
n'écrit dans `listings` — elle empile un job dans la file `ingest.source`
(pg-boss, déjà déclarée au Lot 1) que le worker déjà en cours d'exécution
traite. **Aucun secret eBay ni clé service role ne transite par apps/web.**

### Rôle Postgres dédié à l'enqueue

- `dealradar_enqueue` (migration 0010) : `NOLOGIN`, grants strictement
  limités au schéma `pgboss` (aucun accès à `public`).
- **Activation manuelle requise, jamais automatisée** : un mot de passe ne
  doit jamais figurer dans un fichier versionné. Une fois la migration
  appliquée, exécuter dans le SQL Editor Supabase (jamais committé) :
  ```sql
  alter role dealradar_enqueue with login password '<mot de passe fort>';
  ```
  Puis construire la chaîne `postgresql://dealradar_enqueue:<mot de passe>@<host>:<port>/postgres`
  et la placer dans `DATABASE_URL_ENQUEUE` (apps/web, jamais commitée).
- **⚠️ Risque ouvert documenté** : tant que ce rôle n'est pas activé, la
  page `/admin/ingestion` échoue proprement à l'enqueue (message explicite,
  jamais de repli silencieux). **Ne pas utiliser cette page en production
  avant activation effective du rôle et vérification que les privilèges
  par défaut (`ALTER DEFAULT PRIVILEGES`) s'appliquent bien aux tables que
  pg-boss crée réellement** — la migration accorde ces privilèges par
  défaut pour le rôle exécutant la migration ; si pg-boss crée ses tables
  sous un rôle différent lors de son tout premier démarrage, il faudra
  ré-exécuter manuellement `grant select, insert on all tables in schema
  pgboss to dealradar_enqueue;` après ce premier démarrage.

### Serverless

`apps/web/src/lib/pgboss.ts` utilise un pool à `max: 1` et appelle
`.stop()` après chaque envoi plutôt que de garder une instance persistante
— évite l'accumulation de connexions entre invocations froides. Compromis
latence/sécurité assumé ; un déploiement serverless à fort trafic mériterait
un pooler dédié (non construit dans ce lot).

### Anti double-déclenchement

Index unique partiel `ux_ingestion_runs_active` sur `(source_id,
category_slug, query_text) where status = 'running'` — garantie base de
données contre les races, complétée par une vérification applicative dans
`run-ingestion.ts` pour un message d'erreur clair côté UI.

## `raw_payload` — minimisation et rétention

- **Liste blanche explicite** (`packages/connectors/src/ebay/redact.ts`) :
  seuls identifiant, titre, prix, condition, catégories, nom d'utilisateur
  vendeur et date de création sont conservés. Tout le reste (descriptions
  longues, détails de livraison, images) est déjà capturé dans les colonnes
  normalisées dédiées et n'a pas besoin d'être dupliqué dans le payload brut.
- `raw_payload_collected_at` horodate la capture.
- `public.purge_raw_payloads(older_than interval)` (migration 0010) : purge
  manuelle, durée configurable à l'appel. **Politique recommandée : 30
  jours**, à exécuter périodiquement (`select
  public.purge_raw_payloads('30 days'::interval);`) — aucune planification
  automatique construite dans ce lot.
- Conformité : ce payload minimisé reste des données publiques d'annonce
  (titre, prix, condition, nom d'utilisateur vendeur) déjà exposées par les
  colonnes normalisées de `listings` — aucune donnée supplémentaire n'est
  introduite, seule la traçabilité vers la source est ajoutée.

## Observabilité

- Logs structurés (pino, déjà en place) pour chaque étape (recherche,
  persistance, analyse).
- En-têtes de rate-limit (`retry-after`, `x-ratelimit-*`) journalisés
  génériquement quand présents — noms exacts d'en-têtes eBay à confirmer
  contre l'API réelle (limite documentée, aucun identifiant disponible pour
  vérifier).
- `Retry-After` respecté sur 429 ; retries strictement bornés (défaut : 3),
  jamais sur 400/403/404.
- Diagnostic : la page `/admin/ingestion` sert de vue de diagnostic simple
  (dernier run, durée, annonces récupérées, erreurs) — pas de fonction SQL
  séparée construite dans ce lot, la lecture directe des tables suffit à ce
  stade.
- Aucun secret (client secret, token OAuth) n'apparaît jamais dans un log
  ou un message d'erreur — vérifié par les tests (`client.test.ts`,
  `oauth.test.ts`, `connector.test.ts`).

## Procédure : ajouter un nouveau connecteur

1. Implémenter `MarketplaceConnector` dans `packages/connectors/src/<source>/`.
2. Déclarer honnêtement les `capabilities` réellement supportées (ne jamais
   déclarer `soldPrices` sans une source de ventes conclues vérifiée).
3. Réutiliser `packages/ingestion` tel quel (`runIngestion`,
   `analyzeListing`) — aucune logique à dupliquer, ils sont déjà
   génériques par construction.
4. Ajouter le connecteur à `apps/workers/src/ingestion/connector-config.ts`
   (ou équivalent) et enregistrer la source dans `public.sources`.

## Procédure : configurer eBay

1. Créer une application sur [developer.ebay.com](https://developer.ebay.com/), commencer en
   **sandbox** (`EBAY_ENVIRONMENT=sandbox`).
2. Renseigner `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_MARKETPLACE_ID`
   (ex. `EBAY_CH`, `EBAY_DE`, `EBAY_US`) dans l'environnement des workers
   uniquement — jamais dans apps/web.
3. Vérifier la connexion : `pnpm --filter @dealradar/workers ingest --category lego --q "test"`.
4. Ne passer en production qu'après validation en sandbox et lecture des
   conditions d'utilisation de l'API eBay (Developer Program Policies).

## Commande de test locale

```bash
pnpm --filter @dealradar/workers ingest --category lego --q "lego star wars"
```

Aucune planification automatique n'est construite dans ce lot — un
déclenchement manuel (CLI ci-dessus, ou la page `/admin/ingestion` une fois
`DATABASE_URL_ENQUEUE` activée) suffit pour tester le flux complet.

## Limites assumées

- Aucun identifiant eBay réel disponible pendant ce lot : toute la
  couverture de tests mock les appels réseau (aucune dépendance à un compte
  eBay réel).
- Coût de livraison collecté par le connecteur mais pas encore persisté sur
  `listings` (pas de colonne dédiée) — `shippingCostCents` par défaut à 0
  dans l'analyse, sous-estimation documentée.
- Correspondance eBay aspects → clés de profil de catégorie non construite
  (ex. "Set Number" eBay vs `setNumber` interne) — nécessite des identifiants
  réels pour être vérifiée sans deviner.
- Taxonomie générale (`categories`) non intégrée — `categorySlug` stocké en
  attribut plutôt que via `category_id`.
