# Sources de marché multi-catégories — architecture et feuille de route

Mis à jour par le LOT "Multi-Source Fusion + Source Wave 1" (état réel des
connecteurs eBay/BrickLink/PriceCharting/Google Shopping et du moteur de
fusion — voir la section dédiée en fin de document). Hérité du LOT
"Multi-Source Market Intelligence Foundation". Complète (ne remplace pas)
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
| Keepa (Amazon) | gaming, apple, pc_components, electronics générique | `historicalPrices` (leur spécialité — graphiques de prix Amazon long terme), `retailPrices` | API officielle payante | `KEEPA_API_KEY` — **ABSENT** | Non implémenté ce lot | Keepa fournit un historique déjà calculé par Amazon/Keepa lui-même — palier B (`historicalPrices`), jamais A |

## Marketplaces généralistes

| Source | Catégories | Types de preuve | Accès | Credentials live | Statut | Réserve |
| --- | --- | --- | --- | --- | --- | --- |
| eBay | toutes (`any`) | `activeListings`, `itemDetails` | API Browse officielle OAuth, déjà en Production | `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` — noms présents en local (`.env.local`), valeurs vides ; présents sur Railway (jamais vérifiés fonctionnels ce lot) | **Déjà implémenté** (`packages/connectors/src/ebay/`), pré-existant, jamais modifié par ce lot. **Adapté en `MarketSource`** ce lot (`packages/connectors/src/ebay/market-source-adapter.ts`, wrapper fin sans duplication OAuth/HTTP) pour rejoindre le chemin d'orchestration commun — `activeListings` uniquement, toujours palier D, `soldAt` jamais renseigné | Ne déclare jamais `soldTransactions` — Browse API n'expose aucune vente conclue sans accès partenaire (ADR 0008). Filtrage lot/bundle/pièces détachées volontairement PAS appliqué dans l'adaptateur (le paquet `connectors` n'a aucune dépendance à `@dealradar/core`) — appliqué en aval, dans `fuseMarketObservations` (voir section Fusion) |
| Ricardo (Suisse) | toutes | `activeListings` probable | Pas d'API publique documentée connue — nécessiterait un accès négocié ou un scraping de pages publiques (jamais de contournement de connexion) | — | Non implémenté — `web/types.ts` (`WebMarketplaceFetcher`) déjà préparé comme scaffolding pour ce cas, jamais câblé | Vérifier les CGU avant tout scraping, même de pages publiques |
| Tutti (Suisse) | toutes | `activeListings` probable | Idem Ricardo | — | Non implémenté | Idem Ricardo |
| Anibis (Suisse) | toutes | `activeListings` probable | Idem Ricardo | — | Non implémenté | Idem Ricardo |

## Sources spécialisées

| Source | Catégories | Types de preuve | Accès | Credentials live | Statut | Réserve |
| --- | --- | --- | --- | --- | --- | --- |
| BrickLink | lego | `historicalPrices` (price guide `guide_type=sold`, palier **B**, jamais A) + `activeListings` (`guide_type=stock`, inventaire courant, palier D) | API officielle (BrickLink API, OAuth 1.0a signé à la main — `packages/connectors/src/bricklink/oauth1.ts`) | Le connecteur prend les 4 credentials OAuth1 (`consumerKey`/`consumerSecret`/`token`/`tokenSecret`, voir `BrickLinkClientOptions`) en OPTIONS INJECTÉES, pas de lecture directe de `process.env` dans le paquet `connectors` (même discipline que tous les autres connecteurs de ce paquet — c'est `apps/workers` qui lirait l'environnement, pas encore câblé ce lot). Aucun nom de variable d'environnement canonique n'existe donc encore dans le code pour ces 4 secrets — à définir lors du câblage `apps/workers` | **Implémenté ce lot** (`packages/connectors/src/bricklink/`) : signeur OAuth 1.0a vérifié par un test croisé non-tautologique (base HMAC-SHA1 dérivée à la main, indépendante de l'implémentation), client HTTP, normalisation, connecteur. Tests complets (26 tests : oauth1/normalize/connector). **NOT TESTED live** — aucune credential disponible et aucun câblage `apps/workers` ce lot | **Décision de palier documentée** : le "sold" (6 derniers mois) de BrickLink est une agrégation de statistiques (`min`/`max`/`avg`/`qty_avg_price`) sur la période, PAS un horodatage de vente individuelle confirmée dans la réponse API — impossible de garantir A sans supposer une sémantique non documentée. Choix conservateur : **palier B**, jamais A tant que la sémantique exacte de `date_ordered` (champ marqué non fiable dans `raw-types.ts`) n'est pas vérifiée contre un appel live réel. `search()` exige `hints.bricklinkNo`, ne devine jamais un numéro de set |
| PriceCharting | gaming, collectibles | `historicalPrices` (loose/CIB/neuf/gradé séparés) | API HTTP simple (token en paramètre de requête, voir `PriceChartingClientOptions.token`, injecté — même discipline que BrickLink ci-dessus, aucun nom d'env var canonique encore défini), mais **conditions de licence commerciale non vérifiées** pour un usage serveur applicatif (déjà noté bloquant dans `external-data-sources.md`) | Non câblé dans `apps/workers` ce lot — aucun secret à auditer | **Contrat typé implémenté et testé ce lot** (`packages/connectors/src/pricecharting/`), conformément à l'instruction du lot ("si la licence rend l'usage serveur incertain, documenter et s'arrêter à un contrat/adaptateur typé plutôt que de forcer") : normalisation en jusqu'à 4 observations distinctes (loose/CIB/neuf/gradé), toutes palier B. **NOT TESTED live**, **réserve de licence toujours ouverte** — ne pas activer en production sans vérification explicite des CGU commerciales PriceCharting | Chaque champ de prix est une valeur de marché CALCULÉE par PriceCharting à partir de son historique agrégé — jamais une transaction individuelle confirmée, jamais palier A. Devise toujours USD (marché ciblé par l'API) |
| TCGplayer | pokemon_tcg (et autres TCG plus tard) | `activeListings`, `historicalPrices` | API officielle (partenaire) | `TCGPLAYER_PUBLIC_KEY`/`TCGPLAYER_PRIVATE_KEY` — **ABSENT** | Non implémenté — JustTCG/TCGdex couvrent déjà le pricing TCG pour ce MVP (voir `external-data-sources.md`) | Redondant à court terme avec les sources TCG déjà branchées ; utile si JustTCG s'avère insuffisant en couverture |
| StockX | sneakers (et objets "bid/ask" plus tard) | `bidAsk` (leur mécanisme natif : offre/demande en direct, jamais un prix affiché unique) | Pas d'API publique officielle documentée | — | Non implémenté | Aucun scraping envisagé sans API officielle — StockX est connu pour une politique anti-bot stricte, hors de portée de ce lot (règle absolue : aucun contournement anti-bot) |
| WatchCharts | watches | `historicalPrices` | Payant, licence à vérifier | — | Non implémenté, explicitement "later" (voir instruction du lot) | Coût/licence à évaluer avant toute intégration |

## Fournisseurs de scraping générique (vendeurs, jamais un contournement maison)

`ScrapingProvider` (`packages/connectors/src/market-intelligence/scraping-provider.ts`)
est l'interface UNIQUE que DealRadar utilise — aucune logique anti-bot n'est
jamais implémentée dans ce repo. Une implémentation concrète par vendeur reste à
construire quand un besoin réel et légalement clair se présente (ex. Ricardo/
Tutti/Anibis si aucune API publique n'existe).

| Vendeur | Rendu JS | Ciblage géo | Statut | Credentials |
| --- | --- | --- | --- | --- |
| Zyte | Oui (Smart Proxy Manager + Automatic Extraction) | Oui | Non implémenté — interface prête (`ScrapingProvider`), mock uniquement (`createMockScrapingProvider`) | `ZYTE_API_KEY` — **ABSENT** |
| Bright Data | Oui (Web Unlocker) | Oui | Non implémenté | `BRIGHTDATA_API_KEY` — **ABSENT** |
| Apify | Oui (actors) | Selon l'actor | Non implémenté | `APIFY_API_TOKEN` — **ABSENT** |
| Oxylabs | Oui | Oui | Non implémenté, non prioritaire | — |

## Hiérarchie de qualité de preuve (rappel, voir `evidence-tiers.ts`)

| Palier | Sémantique | Exemples de sources |
| --- | --- | --- |
| A | Vente confirmée | eBay Marketplace Insights (accès partenaire, non branché) |
| B | Marché spécialisé, donnée calculée | Keepa (historique Amazon calculé), guides de prix TCG (JustTCG), **BrickLink "sold" (agrégat 6 mois, jamais A — voir décision ci-dessus)**, **PriceCharting (loose/CIB/neuf/gradé)** |
| C | Marché bid/ask en direct | StockX |
| D | Annonce active | eBay Browse API, Google Shopping (occasion), Ricardo/Tutti/Anibis |
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

## 3 prochaines intégrations les plus utiles (recommandation)

1. **SerpApi (activation de la clé) + câblage credentials BrickLink/PriceCharting
   dans `apps/workers`** — les trois connecteurs sont entièrement construits,
   testés et déjà câblés dans l'agrégateur/le routage ; il ne manque que des
   secrets réels et le point de câblage `apps/workers` (non fait ce lot, hors
   scope connecteurs) pour passer de "NOT TESTED live" à un premier flux réel
   multi-source.
2. **Ricardo/Tutti/Anibis** (marché suisse, cohérent avec la devise CHF déjà
   utilisée partout dans le pipeline) — nécessite d'abord de vérifier s'il
   existe une API publique légitime avant d'envisager `ScrapingProvider` avec
   un vendeur géré.
3. **Keepa** — explicitement différé au lot précédent ("Keepa deferred to next
   lot"), toujours non implémenté ; palier B (historique déjà calculé par
   Amazon/Keepa), pertinent pour gaming/apple/pc_components.
