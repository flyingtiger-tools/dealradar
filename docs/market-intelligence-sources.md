# Sources de marché multi-catégories — architecture et feuille de route

LOT "Multi-Source Market Intelligence Foundation". Complète (ne remplace pas)
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
| Google Shopping (SerpApi) | toutes (`any`) | `retailPrices`, `activeListings` (si `second_hand_condition`), `search` | API officielle (agrégateur légal de résultats Google) | `SERPAPI_KEY` — **ABSENT** (local et non vérifié sur Railway ce lot) | **Implémenté** (`packages/connectors/src/google-shopping/`) : client/normalize/connecteur + tests fixtures complets. **NOT TESTED live** — aucun appel réel possible sans clé | Jamais présenté comme vente confirmée (Google Shopping n'expose que des prix affichés à l'instant T) |
| Google Shopping (DataForSEO) | toutes | idem SerpApi | API officielle, alternative tarifaire à SerpApi | `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` — **ABSENT** | Non implémenté — `SerpApi` retenu en premier (implémentation plus simple, un seul secret plutôt qu'une paire login/mot de passe + auth basique) | — |
| Keepa (Amazon) | gaming, apple, pc_components, electronics générique | `historicalPrices` (leur spécialité — graphiques de prix Amazon long terme), `retailPrices` | API officielle payante | `KEEPA_API_KEY` — **ABSENT** | Non implémenté ce lot | Keepa fournit un historique déjà calculé par Amazon/Keepa lui-même — palier B (`historicalPrices`), jamais A |

## Marketplaces généralistes

| Source | Catégories | Types de preuve | Accès | Credentials live | Statut | Réserve |
| --- | --- | --- | --- | --- | --- | --- |
| eBay | toutes (`any`) | `activeListings`, `itemDetails` | API Browse officielle OAuth, déjà en Production | `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` — absents en local, présents sur Railway (jamais vérifiés fonctionnels ce lot) | **Déjà implémenté** (`packages/connectors/src/ebay/`), pré-existant, non touché par ce lot | Ne déclare jamais `soldTransactions` — Browse API n'expose aucune vente conclue sans accès partenaire (ADR 0008) |
| Ricardo (Suisse) | toutes | `activeListings` probable | Pas d'API publique documentée connue — nécessiterait un accès négocié ou un scraping de pages publiques (jamais de contournement de connexion) | — | Non implémenté — `web/types.ts` (`WebMarketplaceFetcher`) déjà préparé comme scaffolding pour ce cas, jamais câblé | Vérifier les CGU avant tout scraping, même de pages publiques |
| Tutti (Suisse) | toutes | `activeListings` probable | Idem Ricardo | — | Non implémenté | Idem Ricardo |
| Anibis (Suisse) | toutes | `activeListings` probable | Idem Ricardo | — | Non implémenté | Idem Ricardo |

## Sources spécialisées

| Source | Catégories | Types de preuve | Accès | Credentials live | Statut | Réserve |
| --- | --- | --- | --- | --- | --- | --- |
| BrickLink | lego | `soldTransactions` (price guide "sold last 6 months") + `activeListings` (inventaire courant) | API officielle (BrickLink API, OAuth 1.0a) | `BRICKLINK_CONSUMER_KEY`/`BRICKLINK_CONSUMER_SECRET`/`BRICKLINK_TOKEN`/`BRICKLINK_TOKEN_SECRET` — **ABSENT** | Non implémenté — priorité #1 recommandée pour LEGO (voir "prochaines intégrations") | Le "sold last 6 months" de BrickLink EST une vente confirmée déclarée par le vendeur au moment de la transaction — palier A légitime, à vérifier contre leurs CGU exactes avant implémentation |
| PriceCharting | gaming, collectibles | `historicalPrices`, `retailPrices` | Accès nécessitant une autorisation écrite (déjà noté bloquant dans `external-data-sources.md`) | — | **Bloqué** — pas une question de coût mais d'autorisation d'accès, indépendamment de ce lot | Ne jamais scraper sans autorisation explicite |
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
| A | Vente confirmée | eBay Marketplace Insights (accès partenaire, non branché), BrickLink "sold last 6 months" |
| B | Marché spécialisé, donnée calculée | Keepa (historique Amazon calculé), guides de prix TCG (JustTCG) |
| C | Marché bid/ask en direct | StockX |
| D | Annonce active | eBay Browse API, Google Shopping (occasion), Ricardo/Tutti/Anibis |
| E | Prix affiché neuf | Google Shopping (neuf), sites marchands |

Jamais une simple moyenne de tous les paliers ensemble — un appelant qui estime
un prix doit toujours pondérer/filtrer explicitement par palier (voir
`ACTIVE_LISTING_CONFIDENCE_CAP`, `packages/core/src/intelligence/pipeline.ts`,
pour l'exemple déjà en place à 2 paliers sur le pipeline TCG existant, non
modifié par ce lot).

## 3 prochaines intégrations les plus utiles (recommandation)

1. **BrickLink** — seule source de ce document offrant une preuve palier A
   (ventes confirmées) hors eBay, sur une catégorie (LEGO) où DealRadar a déjà
   une forte couverture catalogue. API officielle, pas de scraping.
2. **SerpApi (activation de la clé)** — le connecteur est déjà entièrement
   construit et testé ; il ne manque qu'une clé `SERPAPI_KEY` pour passer de
   "NOT TESTED live" à un premier flux réel multi-catégories.
3. **Ricardo/Tutti/Anibis** (marché suisse, cohérent avec la devise CHF déjà
   utilisée partout dans le pipeline) — nécessite d'abord de vérifier s'il
   existe une API publique légitime avant d'envisager `ScrapingProvider` avec
   un vendeur géré.
