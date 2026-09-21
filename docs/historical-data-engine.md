# Moteur de données historiques — identité produit, instantanés, intelligence de prix

LOT "Historical Data Engine + Product Identity Enrichment + Live-Readiness".
Complète (ne remplace pas) [`market-intelligence-sources.md`](./market-intelligence-sources.md),
qui reste la référence pour le STATUT de chaque source (implémentée/testée
en direct/limitations d'accès). Ce document couvre l'ARCHITECTURE qui
transforme un scan utilisateur ponctuel en intelligence de prix
longitudinale — jamais l'inverse, jamais une réécriture des sources
elles-mêmes.

## Pourquoi ce lot

Jusqu'ici, DealRadar interrogeait des sources de marché UNIQUEMENT à la
demande d'un scan utilisateur (`orchestrateMarketIntelligence`,
`packages/ingestion`), sans jamais accumuler d'historique indépendamment de
ce scan. Ce lot ajoute la machinerie — identité produit canonique,
planification de requête, moteur d'instantané, cycle de vie d'annonce,
intelligence d'historique V2, politique de planification, matrice de
préparation live — pour que DealRadar devienne progressivement un moteur
de données, sans jamais fabriquer une identité, un identifiant, une vente
ou un taux de change.

## 1. Identité produit canonique

`CanonicalProductIdentity` (`packages/core/src/identity/canonical-product-identity.ts`)
— la forme UNIQUE sous laquelle DealRadar reconnaît "le même produit" à
travers des sources hétérogènes. Chaque champ est une `FieldClaim`
(`{value, source, confidence, observedAt}`) — jamais un champ nu sans
provenance.

**Champs durs** (`HARD_CONFLICT_FIELDS`) — un désaccord entre deux sources
sur l'un de ces champs est un CONFLIT explicite, jamais résolu
silencieusement : `mpn`, `gtin`, `ean`, `upc`, `asin`, `bricklinkNo`,
`priceChartingId`, `platform`, `storage`, `size`, `edition`.

**Champs doux** (`SOFT_FIELDS`) — un désaccord ne bloque jamais la fusion,
la claim la plus digne de confiance l'emporte : `brand`, `model`,
`variant`, `color`, `generation`, `region`, `language`, `styleCode`, `sku`,
`normalizedConditionTarget`.

`productKey` (`deriveProductKey`) est la SEULE valeur que ce module génère
lui-même — un slug déterministe (catégorie+marque+modèle+variante+
stockage+taille+couleur), jamais un identifiant externe fabriqué, jamais
une valeur aléatoire/horodatée.

### Moteur de fusion (`merge-identity-evidence.ts`)

`mergeIdentityEvidence(identity, evidence)` — fonction PURE, combine une
nouvelle preuve (scan IA, code-barres, détails connecteur, attributs
d'annonce, alias déjà persisté) avec une identité déjà connue :
- champ manquant -> enrichi ;
- même valeur (casse/espaces near) -> aucun conflit ;
- champ DUR en désaccord -> conflit ajouté à `identity.conflicts`, la
  claim EXISTANTE n'est JAMAIS écrasée silencieusement ;
- champ DOUX en désaccord -> la claim la plus digne de confiance
  l'emporte, jamais de conflit ni de blocage.

`resolveIdentityConflict` résout un conflit EXPLICITEMENT (jamais
automatiquement) — aucune règle de résolution automatique n'existe
aujourd'hui.

### Persistance (migration 0019, non appliquée à la Production)

`market_products` (champs doux, une ligne par `product_key`) +
`market_product_identifiers` (une ligne PAR AFFIRMATION — produit, champ,
valeur, source, confiance, horodatage). Un désaccord entre deux sources
sur un champ dur reste représenté comme DEUX LIGNES distinctes, jamais
fusionné au niveau du schéma. Volontairement AUCUNE contrainte de clé
étrangère depuis `market_observations.product_key` (0018, déjà existante,
nullable) vers `market_products.product_key` : une observation peut
précéder la résolution complète de son identité canonique, jamais une
écriture bloquée par un ordre strict ni une migration destructive des
lignes existantes.

## 2. Planificateur de requête PAR IDENTIFIANT D'ABORD

`buildSearchPlan`/`buildSearchPlans` (`packages/core/src/identity/search-plan.ts`)
remplace la génération de requête ad hoc par connecteur avec une hiérarchie
DÉCLARATIVE et PARTAGÉE, dans l'ordre strict :

1. identifiant NATIF de la source (ASIN Keepa, numéro BrickLink, id
   PriceCharting) ;
2. identifiant UNIVERSEL (GTIN/EAN/UPC/MPN) — comme hint dédié si le
   connecteur l'accepte, sinon comme TEXTE de requête exact pour un
   moteur de recherche généraliste (Google Shopping/DataForSEO) ;
3. marque + modèle + variante EXACTS ;
4. repli CONTRAINT (marque ou modèle seul).

`null` si aucun niveau n'est atteignable — **jamais une requête "poubelle"**
sans substance. `KNOWN_SOURCE_QUERY_PROFILES` déclare le contrat réel de
chaque connecteur RÉELLEMENT construit (Keepa/BrickLink/PriceCharting
n'acceptent QUE des identifiants exacts, jamais un mot-clé ; eBay/Google
Shopping/DataForSEO acceptent un repli textuel).

## 3. Moteur d'instantané de marché

`takeMarketSnapshot` (`packages/ingestion/src/take-market-snapshot.ts`) —
job serveur RÉUTILISABLE, séparé de l'analyse interactive
(`orchestrateMarketIntelligence`, appelée depuis un scan). Flux :

```
identité canonique
  -> plans de requête (buildSearchPlans, un par source disponible)
  -> une source par plan (aggregateMarketObservations, réutilisé tel quel)
  -> dédoublonnage par origine canonique inter-sources (dedupeByCanonicalOrigin)
  -> normalisation FX pour le RÉSUMÉ uniquement (les lignes persistées
     gardent TOUJOURS leur devise d'origine, jamais réécrite)
  -> persistance des observations + de l'identité canonique (fraîcheur last_seen_at)
  -> résumé d'instantané (MarketSnapshotSummary)
```

**Aucune décision utilisateur** (BUY/PASS/REVIEW) n'est jamais calculée
ici — volontairement absent, c'est le rôle distinct d'`orchestrate-market-
intelligence.ts`. Idempotent pour une ré-exécution du même cycle logique :
toute persistance repose sur des upserts à contrainte unique déjà en
place.

Exposé côté worker via `apps/workers/src/jobs/take-product-snapshot.ts`
(`takeProductSnapshot`) — câble les sources RÉELLES de l'environnement
(`buildMarketSourcesFromEnv`) et le routage par catégorie existant
(`resolveSourcesForCategory`, avec plafonds `maxCostClass`/`maxSourceCount`
optionnels). Fonction APPELABLE, aucun scheduler/cron installé par ce lot.

## 4. Politique de planification (pure, aucun scheduler déployé)

`decideNextSnapshotRefresh` (`packages/core/src/scheduling/snapshot-scheduling-policy.ts`)
— produit une décision (`nextRefreshAt`/`priority`), jamais un job planifié
réel. Règles : jamais rafraîchi -> immédiat, priorité 100 ; activité
récente + prix volatil -> 6h ; activité récente seule -> 12h ; prix
volatil seul -> 24h ; stable/ancien -> 7 jours. Un plancher par classe de
coût (`free`=1h, `cheap`=4h, `paid`=12h, `high_cost`=48h) n'est JAMAIS
dépassé, même pour un produit très actif — "never schedule faster than
provider budget/rate constraints" (instruction explicite du lot). Un
produit déjà en retard sur son propre calendrier gagne en urgence, jamais
silencieusement ignoré.

## 5. Cycle de vie d'annonce — RÈGLE ABSOLUE : disparition ≠ vente

`packages/core/src/intelligence/listing-lifecycle.ts` — suit combien de
fois et depuis quand une annonce ACTIVE précise est observée à travers des
cycles successifs. `reconcileListingLifecycles` marque une annonce
`currentlySeen: false`/`disappearedAt` UNIQUEMENT après un délai de
disparition configurable (jamais à la première absence d'un seul cycle).
`confirmedSoldAt` ne peut être renseigné QUE si un appelant transmet une
confirmation de vente provenant EXPLICITEMENT de la source elle-même —
jamais déduit d'une disparition. Prouvé par test : 100 cycles de
disparition consécutifs ne produisent jamais un statut de vente confirmée.

## 6. Distinction explicite des types de preuve

| Signal | Ce que c'est | Ce que ce N'EST PAS |
| --- | --- | --- |
| **Vente confirmée** (`soldAt`/`confirmedSoldAt`) | Renseigné UNIQUEMENT quand la source elle-même le confirme explicitement (`evidenceType: "soldTransactions"`) | Jamais déduit d'une disparition d'annonce, jamais un horodatage de la dernière observation |
| **Disparue** (`disappearedAt`) | Une annonce active non revue depuis plus longtemps que la règle de disparition | Jamais une vente — voir section 5 |
| **Annonce active** (`activeListings`, palier D/C) | Un prix demandé/une offre en direct au moment de la collecte | Jamais une vente conclue |
| **Retail** (`retailPrices`, palier E) | Un prix affiché neuf par un marchand | Jamais une estimation de revente fiable |
| **Historique spécialiste** (`historicalPrices`, palier B) | Une valeur CALCULÉE par un spécialiste (Keepa, PriceCharting, BrickLink "sold" agrégé) à partir de données agrégées | Jamais une transaction individuelle confirmée, sauf indication EXPLICITE contraire de la source |

## 7. Intelligence d'historique de prix V2

`computeHistoryIntelligenceV2` (`packages/core/src/intelligence/history-signals-v2.ts`)
construit SUR `history-signals.ts` (jamais réécrit, ses 15 tests restent
intacts). Ajoute : min/max APRÈS écart des valeurs aberrantes (jamais le
min/max brut) ; tendances 7/30/90/180 jours ; volatilité ; un **proxy de
liquidité explicitement étiqueté comme tel** (`kind: "proxy"`, jamais
présenté comme une liquidité confirmée — dérivé du renouvellement
d'annonces actives, aucune vente n'y entre) ; supply active (annonces
`currentlySeen: true` uniquement) ; diversité de sources SUR TOUT
l'historique ; position percentile du prix actuel dans la distribution
historique ; confiance 0–100 basée sur profondeur/fraîcheur/diversité —
**ne surestime jamais la précision d'un historique peu profond**, même si
le calcul statistique "réussit" techniquement sur 1-2 points.

## 8. Cibles de recherche (watchlist) — comment un scan devient une intelligence à long terme

`research_targets` (migration 0020, non appliquée à la Production) — PAS
un objet d'interface, une donnée de planification pure. `apps/workers/src/
jobs/process-analysis.ts` amorce désormais AUTOMATIQUEMENT une cible après
CHAQUE identification réussie (catégorie confirmée, état détecté, prix
d'achat confirmé) — **indépendamment du résultat de l'estimation**
(BUY/PASS/INSUFFICIENT_DATA n'a aucune influence sur cet amorçage).
L'écriture est ISOLÉE (try/catch dédié) : un échec ne fait JAMAIS échouer
la requête d'analyse de l'utilisateur — prouvé par test explicite. C'est
précisément le mécanisme qui permet à UN scan utilisateur d'amorcer un
suivi de prix à long terme, exactement le critère de succès du lot.

## 9. Diagnostics de couverture

`MarketCoverageReport` (`packages/ingestion/src/market-coverage-report.ts`)
— sources interrogées/réussies/échouées, observations retournées/après
dédoublonnage canonique/utilisables après FX/persistées, latence médiane,
classe de coût par source. Volontairement scope LIMITÉ aux sources
RÉELLEMENT interrogées pour UN cycle — ne connaît jamais "quelles sources
sont éligibles/activées" (responsabilité distincte de
`resolveSourcesForCategory`/`buildMarketSourcesFromEnv`, jamais fusionnée
ici). Exposé à la fois par `orchestrateMarketIntelligence` (chemin
interactif) et `takeMarketSnapshot` (chemin instantané).

## 10. Audit FX

`orchestrateMarketIntelligence`/`takeMarketSnapshot` persistent désormais
CHAQUE taux effectivement utilisé via `persistFxRate` (`fx_rates`, déjà
générique, aucun couplage à la verticale TCG) — isolé (une panne ne bloque
jamais la fusion/l'instantané), idempotent (contrainte unique déjà en
place).

## 11. Matrice de préparation live

`SOURCE_READINESS_MATRIX`/`resolveSourceReadiness` (`packages/connectors/
src/market-intelligence/source-readiness-matrix.ts`) — descripteur
déclaratif de CHAQUE source connue (implémentée ou seulement candidate) :
variables d'environnement requises/optionnelles, couverture catégorie,
capacités, `liveTested` (jamais confondu avec "implémenté"),
`activationStatus` (`ready`/`missing_credentials`/`restricted`/
`disabled_policy`/`license_required`), classe de coût,
`productionAllowed`. Un verrou de POLITIQUE (Ricardo/Tutti/Anibis/
TCGplayer/StockX/WatchCharts/PriceCharting) prime TOUJOURS sur la présence
de credentials — poser une clé API ne les rend jamais "ready". Activer une
credential plus tard pour une source `productionAllowed: true` (eBay,
SerpApi, DataForSEO, BrickLink, Keepa, Zyte, Frankfurter) devient une
étape de CONFIGURATION, jamais une réécriture d'architecture — objectif
explicite de ce lot, atteint.

## 12. Ce qui N'A PAS été construit ce lot (limites honnêtes)

- Aucun scheduler/cron n'est déployé — `decideNextSnapshotRefresh` produit
  une décision, un futur job planifié qui LA CONSOMME reste à construire.
- `research_targets` est amorcé automatiquement, mais aucun job ne LIT
  encore les cibles dues (`next_refresh_at`) pour déclencher un
  `takeProductSnapshot` — la boucle de rafraîchissement à long terme n'est
  pas encore bouclée, seulement l'amorçage.
- Les migrations 0019/0020 sont committées mais NON appliquées à la
  Production (garde-fou de l'outillage, action humaine délibérée).
