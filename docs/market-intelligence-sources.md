# Sources de marché multi-catégories — architecture et feuille de route

Mis à jour par le LOT "Source Wave 2" (Keepa, marchés suisses Ricardo/
Tutti/Anibis, premier fournisseur de scraping géré (Zyte), câblage worker,
intégration dans le pipeline d'analyse générique — voir les sections
dédiées en fin de document). Hérite du LOT "Multi-Source Fusion + Source
Wave 1" (état eBay/BrickLink/PriceCharting/Google Shopping et moteur de
fusion) et du LOT "Multi-Source Market Intelligence Foundation". Complète (ne remplace pas)
[`external-data-sources.md`](./external-data-sources.md), qui reste la référence
pour le statut licence MVP-vs-commercial des sources **TCG** déjà branchées
(eBay, Pokémon TCG API, JustTCG, TCGdex, Frankfurter/OpenExchangeRates). Ce
document couvre les sources **larges/spécialisées non-TCG** visées par ce lot,
qu'elles soient déjà implémentées ou seulement candidates.

## Principe architectural

Toute nouvelle source de marché implémente `MarketSource`
(`packages/connectors/src/market-intelligence/market-source.ts`) et retourne des
`MarketObservation[]` (`market-observation.ts`) — jamais un format intermédiaire
propre à la source. L'agrégateur multi-source
(`packages/ingestion/src/aggregate-market-observations.ts`) et le routage par
catégorie (`source-routing.ts`) ne connaissent JAMAIS le nom d'une source
particulière : ajouter une source plus tard est un connecteur de plus dans
`CATEGORY_SOURCE_PREFERENCES`, jamais une réécriture de l'agrégateur ou du
moteur d'estimation (voir `evidence-tiers.ts` pour la hiérarchie de qualité de
preuve, indépendante du nom de la source).

Aucune source de ce document ne doit jamais :
- présenter une annonce disparue comme une vente confirmée (`soldAt` reste
  `null` sauf confirmation explicite de la source) ;
- être scrapée derrière une authentification, un mur de connexion, ou un
  contournement anti-bot/CAPTCHA ;
- avoir un prix de vente fabriqué en son absence.

## Sources larges (retail)

| Source | Catégories | Types de preuve | Accès | Credentials live | Statut | Réserve |
| --- | --- | --- | --- | --- | --- | --- |
| Google Shopping (SerpApi) | toutes (`any`) | `retailPrices`, `activeListings` (si `second_hand_condition`), `search` | API officielle (agrégateur légal de résultats Google) | `SERPAPI_KEY` — **ABSENT** (local et non vérifié sur Railway ce lot) | **Implémenté et câblé** (`packages/connectors/src/google-shopping/`) : client/normalize/connecteur + tests fixtures complets. Câblé ce lot dans le chemin commun `resolveSourcesForCategory` → `aggregateMarketObservations` (`packages/ingestion/src/__tests__/google-shopping-source-integration.test.ts`, fetch factice). **NOT TESTED live** — aucun appel réel possible sans clé | Jamais présenté comme vente confirmée (Google Shopping n'expose que des prix affichés à l'instant T) |
| Google Shopping (DataForSEO) | toutes | idem SerpApi | API officielle, alternative tarifaire à SerpApi | `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` — **ABSENT** | Non implémenté — `SerpApi` retenu en premier (implémentation plus simple, un seul secret plutôt qu'une paire login/mot de passe + auth basique) | — |
| Keepa (Amazon) | gaming, apple, pc_components | `retailPrices` (séries AMAZON/NEW, palier E) + `historicalPrices` (séries USED/COLLECTIBLE/REFURBISHED/WAREHOUSE/NEW_FBA, palier B) + `barcodeLookup` (paramètre `code`, EAN/UPC/ISBN) | API officielle payante, `GET /product` | `KEEPA_API_KEY` — **ABSENT** (nom canonique exigé par ce lot, câblé dans `apps/workers/src/ingestion/market-source-factory.ts`) | **Implémenté et câblé ce lot** (`packages/connectors/src/keepa/`) : énumération `CsvType` reprise du backend open-source officiel Keepa (`keepacom/api_backend`), downsampling d'historique documenté (premier+dernier point, points de changement ≥5%, au moins un point par fenêtre de 30 jours — jamais un horodatage fabriqué), 26 tests. **NOT TESTED live** — aucune clé disponible | Keepa ne représente JAMAIS une vente individuelle confirmée sur cet endpoint (seulement un historique de prix affichés/trackés) — jamais palier A, quelle que soit la série. AMAZON/NEW = retail neuf (palier E) ; USED/COLLECTIBLE/REFURBISHED/WAREHOUSE/NEW_FBA = suivi spécialisé Keepa de marchés secondaires (palier B), jamais fusionnés entre eux |

## Marketplaces généralistes

| Source | Catégories | Types de preuve | Accès | Credentials live | Statut | Réserve |
| --- | --- | --- | --- | --- | --- | --- |
| eBay | toutes (`any`) | `activeListings`, `itemDetails` | API Browse officielle OAuth, déjà en Production | `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` — noms présents en local (`.env.local`), valeurs vides ; présents sur Railway (jamais vérifiés fonctionnels ce lot) | **Déjà implémenté** (`packages/connectors/src/ebay/`), pré-existant, jamais modifié par ce lot. **Adapté en `MarketSource`** ce lot (`packages/connectors/src/ebay/market-source-adapter.ts`, wrapper fin sans duplication OAuth/HTTP) pour rejoindre le chemin d'orchestration commun — `activeListings` uniquement, toujours palier D, `soldAt` jamais renseigné | Ne déclare jamais `soldTransactions` — Browse API n'expose aucune vente conclue sans accès partenaire (ADR 0008). Filtrage lot/bundle/pièces détachées volontairement PAS appliqué dans l'adaptateur (le paquet `connectors` n'a aucune dépendance à `@dealradar/core`) — appliqué en aval, dans `fuseMarketObservations` (voir section Fusion) |
| Ricardo (Suisse) | toutes | `activeListings` (JSON-LD schema.org `Product`/`Offer`, palier D) | **Constat factuel de ce lot** : AUCUNE API publique en libre-service. L'API officielle documentée (`help.ricardo.ch`, section "Interface (**Archives**)") est un service SOAP/JSON de 2013 (`ws.betaqxl.com`/`ws.ricardo.ch`), exige un `PartnershipID`/`PartnershipPWD` négocié — pas un accès ouvert, et son statut "Archives" suggère qu'il n'est plus activement maintenu. Le site utilise Cloudflare (confirmé via son `robots.txt`, qui documente un "challenge Cloudflare" sur les pages de login) et son `robots.txt` exclut explicitement les crawlers connus pour du scraping (Ahrefs, SEMrushBot, MJ12bot, dotbot, etc.) ainsi que sa PROPRE API JSON interne (`Disallow: /api/mfa/search`, `/marketplace-spa/api/`) et toute URL de recherche paramétrée (`Disallow: /*/s/*?`) — exactement le motif qu'une recherche automatisée utiliserait | Aucune credential Ricardo dédiée — le connecteur (`createRicardoConnector`) prend un `ScrapingProvider` générique en paramètre (voir Zyte ci-dessous) | **Contrat + fixtures implémentés et testés ce lot** (`packages/connectors/src/ricardo/`) : `parseRicardoListingHtml` reçoit du HTML déjà récupéré (jamais lui-même un `fetch`) et en extrait des blocs JSON-LD schema.org `Product`/`Offer` (vocabulaire standard, jamais un ciblage de sélecteurs CSS fragile). Fixtures RÉDIGÉES À LA MAIN (jamais une capture live — voir réserve), 14 tests (parse + connecteur). **NOT TESTED live, activation en Production NON RECOMMANDÉE** sans clarification légale/technique supplémentaire | Étant donné Cloudflare + les exclusions `robots.txt` ci-dessus, une extraction automatisée soutenue risquerait réellement de déclencher un challenge anti-bot — que ce lot s'interdit de contourner (règle absolue). Ce connecteur existe pour compléter l'architecture, pas comme une recommandation d'usage immédiat. Les fixtures n'ont jamais été vérifiées contre une page Ricardo réelle — si Ricardo n'émet pas ce balisage JSON-LD en pratique, le parseur retournera simplement un tableau vide, jamais une extraction incorrecte |
| Tutti (Suisse) | toutes | — | **Constat factuel de ce lot** : la page d'accueil ET `robots.txt` renvoient IMMÉDIATEMENT un mur CAPTCHA ("Fülle den Sicherheitscheck aus, um auf tutti.ch zuzugreifen" — vérifié par navigation directe ce lot) | — | **Non implémenté, décision définitive pour ce lot** | Contourner un CAPTCHA est interdit par une règle absolue de ce lot — aucune implémentation possible sans cela |
| Anibis (Suisse) | toutes | — | **Constat factuel de ce lot** : même mur CAPTCHA immédiat que Tutti ("Passez le contrôle de sécurité pour accéder à anibis.ch" — vérifié par navigation directe ce lot) | — | **Non implémenté, décision définitive pour ce lot** | Idem Tutti |

## Sources spécialisées

| Source | Catégories | Types de preuve | Accès | Credentials live | Statut | Réserve |
| --- | --- | --- | --- | --- | --- | --- |
| BrickLink | lego | `historicalPrices` (price guide `guide_type=sold`, palier **B**, jamais A) + `activeListings` (`guide_type=stock`, inventaire courant, palier D) | API officielle (BrickLink API, OAuth 1.0a signé à la main — `packages/connectors/src/bricklink/oauth1.ts`) | `BRICKLINK_CONSUMER_KEY`/`BRICKLINK_CONSUMER_SECRET`/`BRICKLINK_TOKEN_VALUE`/`BRICKLINK_TOKEN_SECRET` — noms canoniques câblés CE LOT dans `apps/workers/src/ingestion/market-source-factory.ts` — **ABSENT** (local et Railway) | **Implémenté et câblé ce lot** (`packages/connectors/src/bricklink/` + usine de sources workers) : signeur OAuth 1.0a vérifié par un test croisé non-tautologique (base HMAC-SHA1 dérivée à la main, indépendante de l'implémentation), client HTTP, normalisation, connecteur. Tests complets (26 tests connecteur + 8 tests usine de sources). **NOT TESTED live** — aucune credential disponible | **Décision de palier documentée** : le "sold" (6 derniers mois) de BrickLink est une agrégation de statistiques (`min`/`max`/`avg`/`qty_avg_price`) sur la période, PAS un horodatage de vente individuelle confirmée dans la réponse API — impossible de garantir A sans supposer une sémantique non documentée. Choix conservateur : **palier B**, jamais A tant que la sémantique exacte de `date_ordered` (champ marqué non fiable dans `raw-types.ts`) n'est pas vérifiée contre un appel live réel. `search()` exige `hints.bricklinkNo`, ne devine jamais un numéro de set |
| PriceCharting | gaming, collectibles | `historicalPrices` (loose/CIB/neuf/gradé séparés) | API HTTP simple (token en paramètre de requête) | `PRICECHARTING_TOKEN` — nom canonique câblé CE LOT dans `apps/workers/src/ingestion/market-source-factory.ts` — **ABSENT**. **Conditions de licence commerciale toujours non vérifiées** pour un usage serveur applicatif (déjà noté bloquant dans `external-data-sources.md`) | **Contrat typé implémenté, câblé ET testé ce lot** (`packages/connectors/src/pricecharting/` + usine de sources workers), conformément à l'instruction du lot précédent ("si la licence rend l'usage serveur incertain, documenter et s'arrêter à un contrat/adaptateur typé plutôt que de forcer") : normalisation en jusqu'à 4 observations distinctes (loose/CIB/neuf/gradé), toutes palier B. **NOT TESTED live**, **réserve de licence toujours ouverte** — ne pas activer en production sans vérification explicite des CGU commerciales PriceCharting, même si le câblage technique est prêt | Chaque champ de prix est une valeur de marché CALCULÉE par PriceCharting à partir de son historique agrégé — jamais une transaction individuelle confirmée, jamais palier A. Devise toujours USD (marché ciblé par l'API) |
| TCGplayer | pokemon_tcg (et autres TCG plus tard) | `activeListings`, `historicalPrices` | API officielle (partenaire) | `TCGPLAYER_PUBLIC_KEY`/`TCGPLAYER_PRIVATE_KEY` — **ABSENT** | Non implémenté — JustTCG/TCGdex couvrent déjà le pricing TCG pour ce MVP (voir `external-data-sources.md`) | Redondant à court terme avec les sources TCG déjà branchées ; utile si JustTCG s'avère insuffisant en couverture |
| StockX | sneakers (et objets "bid/ask" plus tard) | `bidAsk` (leur mécanisme natif : offre/demande en direct, jamais un prix affiché unique) | Pas d'API publique officielle documentée | — | Non implémenté | Aucun scraping envisagé sans API officielle — StockX est connu pour une politique anti-bot stricte, hors de portée de ce lot (règle absolue : aucun contournement anti-bot) |
| WatchCharts | watches | `historicalPrices` | Payant, licence à vérifier | — | Non implémenté, explicitement "later" (voir instruction du lot) | Coût/licence à évaluer avant toute intégration |

## Fournisseurs de scraping générique (vendeurs, jamais un contournement maison)

`ScrapingProvider` (`packages/connectors/src/market-intelligence/scraping-provider.ts`)
est l'interface UNIQUE que DealRadar utilise — aucune logique anti-bot n'est
jamais implémentée dans ce repo.

**Zyte choisi et implémenté ce lot** (`packages/connectors/src/zyte/`, 9
tests) — critères retenus : un seul secret (clé API en identifiant HTTP
Basic, mot de passe vide — pas de paire login/mot de passe comme
DataForSEO), une seule route REST documentée (`POST https://api.zyte.com/v1/
extract`, corps `{url, httpResponseBody: true}` ou `{url, browserHtml:
true}` pour le rendu JS, `geolocation` pour le ciblage pays), gestion
anti-bot/proxy entièrement côté vendeur (jamais de logique DealRadar). Le
client décode le `httpResponseBody` base64 en HTML brut ; `browserHtml` est
déjà du texte brut. **Réserve honnête** : Zyte n'expose aucun coût par
requête dans la réponse de `/v1/extract` — `ScrapeDiagnostics.
estimatedCostUsd` reste donc toujours `null` (jamais un coût inventé),
contrairement à ce que section 4 du lot espérait idéalement obtenir.
**NOT TESTED live** — `ZYTE_API_KEY` **ABSENT**.

| Vendeur | Rendu JS | Ciblage géo | Statut | Credentials |
| --- | --- | --- | --- | --- |
| **Zyte** | Oui (`browserHtml`) | Oui (`geolocation`) | **Implémenté et testé ce lot** (`createZyteScrapingProvider`) | `ZYTE_API_KEY` — **ABSENT** |
| Bright Data | Oui (Web Unlocker) | Oui | Non implémenté | `BRIGHTDATA_API_KEY` — **ABSENT** |
| Apify | Oui (actors) | Selon l'actor | Non implémenté | `APIFY_API_TOKEN` — **ABSENT** |
| Oxylabs | Oui | Oui | Non implémenté, non prioritaire | — |

## Hiérarchie de qualité de preuve (rappel, voir `evidence-tiers.ts`)

| Palier | Sémantique | Exemples de sources |
| --- | --- | --- |
| A | Vente confirmée | eBay Marketplace Insights (accès partenaire, non branché) |
| B | Marché spécialisé, donnée calculée | Keepa (historique Amazon calculé), guides de prix TCG (JustTCG), **BrickLink "sold" (agrégat 6 mois, jamais A — voir décision ci-dessus)**, **PriceCharting (loose/CIB/neuf/gradé)** |
| C | Marché bid/ask en direct | StockX |
| D | Annonce active | eBay Browse API, Google Shopping (occasion), Ricardo (contrat/fixtures seulement — voir réserve d'accès ci-dessous, jamais Tutti/Anibis, bloqués par CAPTCHA) |
| E | Prix affiché neuf | Google Shopping (neuf), sites marchands |

Jamais une simple moyenne de tous les paliers ensemble — un appelant qui estime
un prix doit toujours pondérer/filtrer explicitement par palier (voir
`ACTIVE_LISTING_CONFIDENCE_CAP`, `packages/core/src/intelligence/pipeline.ts`,
pour l'exemple déjà en place à 2 paliers sur le pipeline TCG existant, non
modifié par ce lot).

## Moteur de fusion multi-source (LOT "Multi-Source Fusion + Source Wave 1", section 5 — pièce centrale)

`fuseMarketObservations` (`packages/core/src/intelligence/fuse-market-observations.ts`,
23 tests) — fonction PURE, aucune dépendance à `@dealradar/connectors` (même
discipline que `history-signals.ts` : entrée locale `FusionObservation[]`,
jamais `MarketObservation[]` directement ; `packages/ingestion` fait la
conversion). Jamais appelée depuis le pipeline TCG existant (`pipeline.ts`,
non touché).

Étapes, dans l'ordre : filtre devise cible → filtre lot/bundle/pièces
détachées (réutilise `isLikelyBundleOrPartsListing`, déjà existant) → filtre
de compatibilité de variante (`isCompatibleWithTarget` — exclusion stricte
UNIQUEMENT quand les deux côtés déclarent une valeur ET qu'elle diffère,
jamais sur une donnée simplement absente) → écart des valeurs aberrantes PAR
PALIER (jamais inter-palier — une preuve A isolée qui diverge d'une masse de
preuves D/E n'est PAS une aberration statistique, c'est le signal que la
pondération doit faire dominer) → pondération par observation (poids
cardinal par palier × décroissance de fraîcheur exponentielle × matchScore ×
amortissement racine carrée par source) → médiane/percentiles PONDÉRÉS
(jamais une moyenne simple) pour low/fair/high.

Confiance (0-100) : plafonnée par le palier le plus fort présent (A=100,
B=90, C=75, **D=55 — reprend exactement `ACTIVE_LISTING_CONFIDENCE_CAP` du
pipeline TCG existant, pour rester cohérent avec la règle déjà en place**,
E=35 — jamais une confiance élevée type revente sur du retail seul).
Composée de volume (log, saturation lente ~20 observations) + diversité de
sources (saturation à 5 sources distinctes), puis MULTIPLIÉE (pas addition
de bonus fixes) par la fraîcheur et par l'accord entre preuves du palier le
plus fort — une preuve A/B fortement contradictoire réduit la confiance au
lieu d'être moyennée silencieusement (vérifié par test).

**NOT TESTED live** — aucune source réelle (BrickLink/PriceCharting/SerpApi)
n'a de credentials disponibles ce lot ; les 23 tests couvrent le
comportement pur de la fonction avec des fixtures (iPhone 128 vs 256GB, PS5
console vs manette, LEGO neuf vs occasion, jeu loose vs CIB, sneaker mauvaise
taille, palier A qui domine D/E, preuve contradictoire, source unique
nombreuse vs sources diversifiées, décroissance de fraîcheur).

## Intégration orchestration + persistance (sections 4 et 8)

- **Google Shopping** câblé dans le chemin commun : `resolveSourcesForCategory`
  (`source-routing.ts`) → `aggregateMarketObservations` — preuve par un test
  d'intégration avec fetch factice
  (`packages/ingestion/src/__tests__/google-shopping-source-integration.test.ts`).
- **Agrégation → persistance** : `aggregateMarketObservations(...).observations`
  peut être transmis DIRECTEMENT à `persistMarketObservations`, sans
  transformation intermédiaire — preuve par un test d'intégration avec client
  Supabase mocké (`FakeSupabase`)
  (`packages/ingestion/src/__tests__/aggregate-persist-integration.test.ts`) :
  dédoublonnage avant écriture, panne d'une source isolée, ré-exécution
  idempotente. Migration 0018 jamais appliquée en Production par ce lot.

## Usine de sources côté worker (LOT "Source Wave 2", section 5)

`buildMarketSourcesFromEnv()` (`apps/workers/src/ingestion/market-source-
factory.ts`, 8 tests) — construit TOUTES les `MarketSource[]` disponibles
depuis l'environnement du process workers : eBay (adapté), Google Shopping,
BrickLink, PriceCharting, Keepa, Ricardo (via Zyte). Une credential absente
pour UNE source ne désactive jamais les autres — chaque source est
construite indépendamment (`tryBuildSource`), les diagnostics ne portent
que des noms + un booléen `enabled`, jamais une valeur de credential
(vérifié par test explicite). Utilisée par `process-analysis.ts` avec
`resolveSourcesForCategory` (routage par catégorie déjà existant).

## Intégration dans le pipeline d'analyse générique (LOT "Source Wave 2", section 6)

`apps/workers/src/jobs/process-analysis.ts` (chemin non-TCG) appelle
désormais `orchestrateMarketIntelligence()` (`packages/ingestion/src/
orchestrate-market-intelligence.ts`, 7 tests) — mais **UNIQUEMENT en repli**,
exactement selon le même principe déjà en place pour l'annonce active eBay :
seulement quand le pipeline Intelligence Core existant (ventes confirmées en
base + repli eBay) a statué `INSUFFICIENT_DATA`. Jamais un mélange avec une
estimation déjà trouvée par le chemin existant. Chaîne complète :
`aggregateMarketObservations` → persistance ISOLÉE (une panne, ex. migration
0018 non appliquée, ne bloque jamais la suite — vérifié par test avec un
faux client Supabase qui échoue) → conversion de devise
(`mapMarketObservationsToFusionObservations`, jamais de conversion
approximative, une observation sans taux fiable est simplement écartée) →
`fuseMarketObservations` → `decideFromFusedValuation` (`packages/core`,
nouveau ce lot) qui réutilise le moteur de décision EXISTANT (`decide()`,
`decision.ts`) SEULEMENT pour un palier A/B (vente confirmée/marché
spécialisé) — jamais de BUY/PASS automatique sur un palier C/D/E (annonce
active/prix affiché), au mieux `REVIEW`. `grossMargin`/`estimatedFees`/
`netMargin`/`dealScore` réutilisent `computeNetProfit`/`computeDealScore`
existants (fonctions numériques pures, agnostiques de la provenance de
l'évidence — réutilisation sûre). `liquidityScore` utilise une heuristique
volume+fraîcheur DOCUMENTÉE comme approximative (jamais présentée comme
identique à `computeLiquidityScore`, qui suppose une liste de comparables
vendus individuels que la fusion n'a pas).

**Provenance de marché exposée** (`AnalysisResult.marketEvidence`, champ
OPTIONNEL — `marketEvidenceSchema`, `@dealradar/contracts`, jamais une
régression de contrat pour les consommateurs existants qui l'ignorent) :
palier le plus fort, nombre de sources/observations, répartition live vs
historique (par `evidenceType`, jamais par âge), noms de source, et deux
avertissements honnêtes (`retailOnlyWarning` si palier E seul,
`activeListingsOnlyWarning` si palier C/D seul).

**Limite honnête, non résolue ce lot** : aucune source de taux de change LIVE
n'est câblée pour les observations de marché multi-source — une observation
dans une devise étrangère sans taux fourni est simplement écartée (jamais
convertie au hasard), donc en pratique seules les observations déjà dans la
devise de l'analyse (souvent CHF) contribuent aujourd'hui à la fusion côté
worker. `persist-fx-rate.ts` existe déjà mais comme chemin d'ÉCRITURE pour la
verticale TCG, pas comme un lookup réutilisable ici — câblage explicitement
laissé à un lot futur.

## Provenance marchand inter-sources (LOT "Source Wave 2", section 8)

`FusionObservation.merchant` (`fuse-market-observations.ts`) distingue
désormais le CONNECTEUR (`source`, ex. `"google_shopping"`) de l'ORIGINE
RÉELLE (`merchant`, ex. `"ebay"` si Google Shopping restitue une offre
syndiquée du même marchand) — mappé automatiquement depuis
`MarketObservation.marketplace` dans `mapMarketObservationsToFusionObservations`
(`packages/ingestion`). La diversité de sources utilisée pour la confiance ET
l'amortissement de poids (racine carrée) se base maintenant sur cette origine
réelle : un même marchand vu via deux connecteurs différents ne compte
jamais comme deux origines indépendantes (2 tests dédiés dans
`fuse-market-observations.test.ts`).

## 3 prochaines intégrations les plus utiles (recommandation)

1. **Activation des credentials** (Keepa/BrickLink/PriceCharting/SerpApi/Zyte)
   — les cinq connecteurs + le fournisseur de scraping sont entièrement
   construits, testés et câblés jusque dans le pipeline d'analyse générique ;
   il ne manque que des secrets réels pour passer de "NOT TESTED live" à un
   premier flux réel multi-source de bout en bout.
2. **Câblage d'un lookup de taux de change LIVE** pour
   `orchestrateMarketIntelligence` — condition pour que les observations
   Keepa (USD)/PriceCharting (USD) contribuent réellement à la fusion pour
   des analyses en CHF (voir la limite honnête ci-dessus).
3. **StockX ou WatchCharts** (palier C/B respectivement, catégories
   sneakers/watches non couvertes par Source Wave 1/2) — les deux prochaines
   verticales déclarées dans `CATEGORY_SOURCE_PREFERENCES` sans connecteur
   réel derrière.
