# Sources de marché multi-catégories — architecture et feuille de route

Mis à jour par le LOT "Source Wave 3" (abstraction FX réelle avec cache,
DataForSEO comme second fournisseur Google Shopping, audits factuels
TCGplayer/StockX/WatchCharts, priorité/classe de coût dans le routage,
dédoublonnage inter-fournisseurs par origine canonique — voir les sections
dédiées en fin de document). Hérite du LOT "Source Wave 2" (Keepa, marchés
suisses Ricardo/Tutti/Anibis, Zyte, câblage worker, intégration dans le
pipeline d'analyse générique) et du LOT "Multi-Source Fusion + Source Wave
1" (état eBay/BrickLink/PriceCharting/Google Shopping et moteur de fusion).
Complète (ne remplace pas)
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
| Google Shopping (DataForSEO) | toutes | `retailPrices` uniquement (voir réserve) | API officielle Merchant, `POST /v3/merchant/google/products/task_post` puis `GET /v3/merchant/google/products/task_get/advanced/{id}` (auth HTTP Basic `login:password`) | `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` — noms canoniques câblés CE LOT dans `apps/workers/src/ingestion/market-source-factory.ts` — **ABSENT** | **Implémenté et câblé ce lot** (`packages/connectors/src/dataforseo-google-shopping/`, 15 tests) — second fournisseur Google Shopping, indépendant de SerpApi (le lot demandait explicitement "so Google Shopping is not tied to a single aggregator"). **NOT TESTED live** — aucune credential disponible | **Contrainte technique structurante, documentée honnêtement** : contrairement à SerpApi (un seul aller-retour HTTP synchrone), cette API n'a AUCUN mode synchrone pour la recherche de produits — uniquement un modèle de tâche asynchrone. `search()` fait donc POST puis sondage BORNÉ (15s par défaut, configurable) avant GET ; si la tâche n'est pas prête à l'expiration, retourne un résultat vide plutôt qu'une exception ou un blocage — latence réelle mais bornée, compromis honnête face à SerpApi. Aucun champ `condition` documenté par cet endpoint -> toujours palier E (`retailPrices`), jamais D deviné pour une offre d'occasion. `marketplace` = domaine du marchand réel (`domain`/`seller`) — clé pour le dédoublonnage inter-fournisseurs (voir la section dédiée). Code de géociblage requis explicitement (`defaultLocationCode`, jamais deviné dans le code — `2756` = Suisse vérifié ce lot, valeur recommandée câblée dans l'usine de sources workers, surchargeable via `DATAFORSEO_LOCATION_CODE`) |
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
| TCGplayer | pokemon_tcg (et autres TCG plus tard) | `activeListings`, `historicalPrices` | **Constat factuel de ce lot (audit web)** : TCGplayer n'accepte PLUS de nouvelles candidatures développeur publiques depuis le rachat par eBay (2022) — l'accès est restreint aux détenteurs de clés déjà existants et aux partenaires/vendeurs établis (`developer.tcgplayer.com`, candidature publique fermée, aucun délai/liste d'attente publiés) | `TCGPLAYER_PUBLIC_KEY`/`TCGPLAYER_PRIVATE_KEY` — **ABSENT** (et non obtenables via une inscription standard aujourd'hui) | **Non implémenté — accès structurellement indisponible, pas juste "clé manquante"**. Conformément à l'instruction du lot ("if current API onboarding is restricted/deprecated/unavailable, document factual status... rather than inventing access"), aucun code n'a été écrit : un contrat typé pour une API dont je n'ai vérifié ni les champs de réponse réels ni un accès effectif aurait risqué de présenter une structure devinée comme vérifiée | JustTCG/TCGdex couvrent déjà le pricing TCG pour ce MVP (voir `external-data-sources.md`) — aucune régression, cette source reste additive et non bloquante |
| StockX | sneakers (et objets "bid/ask" plus tard) | `bidAsk` (leur mécanisme natif : offre/demande en direct) | **Constat factuel de ce lot (audit web)** : le "StockX Public API" (`developer.stockx.com`, OAuth2 authorization_code + `x-api-key`) est positionnée comme des outils VENDEUR ("Seller/Order/Catalog APIs... to help you manage your business at scale") — conçue pour des vendeurs StockX déjà actifs qui gèrent leur propre inventaire, pas comme une API de recherche de prix ouverte à des tiers non-vendeurs | — | **Non implémenté — accès généralement lié à un statut de vendeur StockX approuvé, pas un accès self-service pour un simple usage de recherche de comparables**. DealRadar n'est pas vendeur sur StockX ; devenir vendeur juste pour lire des données de marché serait disproportionné et hors du périmètre de ce lot. Aucun scraping envisagé en alternative (politique anti-bot stricte connue de StockX, règle absolue du lot) | Palier C (`bidAsk`) resterait la sémantique correcte si l'accès devenait un jour disponible — a réévaluer si DealRadar noue une relation vendeur StockX |
| WatchCharts | watches | `historicalPrices`/`marketPrice` | **Constat factuel de ce lot (audit web, `watchcharts.com/api/license`)** : un abonnement payant "Professional + API" est requis rien que pour obtenir une clé API, ET une licence de Distribution ou de Revente SÉPARÉE (négociée directement avec WatchCharts, jamais self-service) est explicitement exigée pour AFFICHER leurs données à des utilisateurs tiers — exactement l'usage que ferait DealRadar (afficher une valorisation dérivée à ses propres utilisateurs) | — | **Non activé — la licence ne correspond pas à une appli en beta sans accord de distribution négocié**. Aucun contrat/adaptateur typé écrit non plus : la page de documentation technique (`watchcharts.com/api`) était inaccessible ce lot (protection Cloudflare, même symptôme que Tutti/Anibis), donc la forme exacte des champs de réponse n'a jamais pu être vérifiée — écrire un normalizer sur une structure devinée aurait contredit la discipline "jamais une structure inventée" suivie pour toutes les autres sources de ce lot | Palier B (valorisation calculée) resterait la sémantique correcte si une licence de Distribution/Revente était un jour négociée ET que la documentation technique devienne consultable |

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
25 tests, +2 ce lot pour la provenance marchand inter-connecteurs) — fonction PURE, aucune dépendance à `@dealradar/connectors` (même
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
n'a de credentials disponibles ce lot ; les 25 tests couvrent le
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
factory.ts`, 10 tests) — construit TOUTES les `MarketSource[]` disponibles
depuis l'environnement du process workers : eBay (adapté), Google Shopping
(SerpApi), **Google Shopping (DataForSEO, nouveau ce lot)**, BrickLink,
PriceCharting, Keepa, Ricardo (via Zyte). TCGplayer/StockX/WatchCharts ne
sont PAS câblés — aucun connecteur réel n'existe pour eux (voir les
constats factuels d'accès ci-dessus). Ricardo reste construit uniquement si
`ZYTE_API_KEY` est présent, sans activation silencieuse ni changement de
politique ce lot (toujours non recommandé en production, voir plus haut).
Une credential absente pour UNE source ne désactive jamais les autres —
chaque source est construite indépendamment (`tryBuildSource`), les
diagnostics ne portent que des noms + un booléen `enabled`, jamais une
valeur de credential (vérifié par test explicite). Utilisée par
`process-analysis.ts` avec `resolveSourcesForCategory` (routage par
catégorie déjà existant, désormais avec plafonds de coût/compte
optionnels — voir la section dédiée).

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

**Limite résolue ce lot** (Source Wave 3) : `process-analysis.ts` câble
désormais un `fxRateProvider` (Frankfurter mis en cache) dans l'appel à
`orchestrateMarketIntelligence` — une observation dans une devise étrangère
observée bénéficie maintenant d'une tentative de conversion réelle et
horodatée avant d'être potentiellement écartée (voir la section FX dédiée
plus bas pour le détail complet).

## Abstraction FX + cache (LOT "Source Wave 3", section 1)

Point de départ : `FxRateProvider` (`packages/connectors/src/fx/types.ts`)
existait DÉJÀ (deux implémentations réelles pré-existantes : `Frankfurter`,
gratuit sans clé, et `OpenExchangeRates`, payant — voir
`docs/fx-provider-swap.md`). Ce lot ajoute ce qui manquait pour que
`orchestrateMarketIntelligence` puisse réellement les utiliser :

- **`createCachedFxRateProvider`** (`fx/cache.ts`, 5 tests) — enveloppe
  n'importe quel `FxRateProvider` d'un cache mémoire à TTL borné (15 min
  par défaut). Ne met JAMAIS en cache un résultat `null` (une absence
  transitoire est retentée, jamais figée pour toute la durée du TTL). Clé
  de cache par paire ET par date (`onDate`).
- **`resolveFxRates`/`resolveOneFxRate`/`invertFxRate`** (`fx/resolve-
  rates.ts`, 10 tests) — résout un taux DIRECT d'abord, puis la direction
  INVERSE (`1/rate`, mêmes `rateDate`/`source`/`fetchedAt`, jamais une
  nouvelle source de vérité) si le fournisseur ne connaît que l'autre sens.
  Jamais de triangulation via une devise pivot — inutile ici, Frankfurter
  et OpenExchangeRates acceptent tous deux une paire base/quote arbitraire
  directement. Une devise sans taux (aucune des deux directions) est
  simplement absente du résultat, jamais devinée.
- **`orchestrateMarketIntelligence`** accepte désormais un `fxRateProvider`
  optionnel : résout automatiquement un taux pour CHAQUE devise étrangère
  RÉELLEMENT présente parmi les observations agrégées et absente d'un
  éventuel `fxRates` fourni à la main (qui garde toujours la priorité,
  jamais écrasé par une résolution automatique — vérifié par test). La
  fraîcheur maximale utilisable reste gouvernée par `maxRateAgeHours`
  (mécanisme déjà en place au lot précédent, inchangé).
- **`apps/workers/src/jobs/process-analysis.ts`** câble désormais un
  Frankfurter mis en cache (`createCachedFxRateProvider(createFrankfurterProvider())`),
  construit UNE FOIS au niveau module (le cache survit entre plusieurs
  analyses traitées par le même process workers) — choisi comme source FX
  par défaut car gratuit et sans authentification, donc TOUJOURS
  disponible sans configuration supplémentaire (contrairement à chaque
  source de marché elle-même).
- **Test de succès explicitement demandé par le lot** — vérifié
  (`orchestrate-market-intelligence.test.ts`, "succès de la fusion
  multi-devise") : une observation USD (Keepa), une EUR (PriceCharting) et
  une CHF (BrickLink) contribuent TOUTES à une seule fusion en CHF, via des
  taux explicites horodatés résolus automatiquement.

Persistance des taux : `persistFxRate`/`fx_rates` (`packages/ingestion/
src/persist-fx-rate.ts`) restent réutilisables tels quels (table déjà
générique, jamais spécifique à la verticale TCG) mais ne sont PAS
re-branchés dans `orchestrateMarketIntelligence` ce lot — cette fonction ne
fait qu'utiliser un `FxRateProvider` pour CONVERTIR, jamais pour écrire en
base ; router les taux effectivement résolus vers `persistFxRate` pour
audit reste une amélioration future distincte, non nécessaire au succès
du lot.

## Priorité et classe de coût dans le routage (LOT "Source Wave 3", section 6)

`SOURCE_COST_CLASS`/`costClassForSource` (`source-routing.ts`) — classe
DÉCLARATIVE (`free`/`cheap`/`paid`/`high_cost`), JAMAIS un système de
facturation (aucun montant réel suivi). `resolveSourcesForCategory` accepte
désormais `maxSourceCount` (plafond de COMPTE, "budget-ready hook") et
`maxCostClass` (exclut les sources plus chères que le plafond) — appliqués
APRÈS l'ordre de préférence déjà en place par catégorie (`CATEGORY_SOURCE_
PREFERENCES`, qui place déjà les sources gratuites/pertinentes en tête),
donc ces plafonds ne font QUE tronquer la fin d'une liste déjà triée,
jamais un réordonnancement. Une source non déclarée dans `SOURCE_COST_
CLASS` est traitée `"paid"` par défaut — jamais supposée gratuite. Aucun
plafond fourni = comportement strictement inchangé (rétrocompatible, 13
tests couvrant l'existant + les nouveaux plafonds).

## Dédoublonnage par origine canonique inter-fournisseurs (LOT "Source Wave 3", section 7)

`dedupeByCanonicalOrigin` (`packages/connectors/src/market-intelligence/
canonical-origin-dedupe.ts`, 10 tests) — appelé automatiquement par
`aggregateMarketObservations` (après le dédoublonnage par clé source+item+
horodatage déjà existant, jamais à sa place). Traite le cas qu'un même
`marketObservationDedupeKey` ne peut JAMAIS capturer : deux CONNECTEURS
différents (ex. SerpApi et DataForSEO, tous deux Google Shopping) qui
restituent la MÊME offre réelle d'un même marchand.

Volontairement CONSERVATEUR — fusionne UNIQUEMENT quand un identifiant
STRUCTUREL (UPC/EAN/GTIN/MPN) est présent et identique des deux côtés, le
`marketplace` (marchand réel) est identique, la devise est identique, la
condition (si connue des deux côtés) est identique, et le prix est quasi
identique (tolérance 2 %). JAMAIS un rapprochement par simple titre — texte
libre trop ambigu pour distinguer size/storage/variant (le risque de "faux
rapprochement" explicitement à éviter selon le lot). Garde la preuve du
palier le PLUS FORT entre les deux doublons. `AggregateMarketObservations
Result.canonicalOriginMergedCount` expose le nombre de fusions effectuées,
jamais un signal silencieux.

**Limite honnête** : SerpApi et DataForSEO n'exposent aujourd'hui aucun
UPC/EAN/GTIN partagé dans leurs résultats Google Shopping de base (voir les
réserves de chaque connecteur ci-dessus) — le dédoublonnage inter-
fournisseurs pour CES deux sources précises ne se déclenchera donc pas
tant qu'un identifiant structurel commun n'est pas disponible (ex. via une
future étape d'enrichissement produit). Le mécanisme est prêt et testé,
mais son utilité pratique pour SerpApi/DataForSEO dépend de ce futur
enrichissement — documenté honnêtement plutôt que présenté comme déjà
pleinement exploité.

## Diagnostics de provenance étendus (LOT "Source Wave 3", section 9)

`OrchestrateMarketIntelligenceResult` (`packages/ingestion`) expose
désormais : `directSourceCount`/`aggregatorSourceCount` (via `MarketSource.
sourceKind`, nouveau champ optionnel — Google Shopping/DataForSEO déclarent
`"aggregator"`, toutes les autres sources restent `"direct"` par défaut),
`evidenceTypeMix` (répartition brute par `evidenceType`, distincte de la
répartition par palier déjà exposée par `fused.evidenceMix`),
`costClassesUsed` (classes de coût des sources INTERROGÉES, même celles
n'ayant produit aucune observation), et `fx` (`observedCurrencies`,
`ratesUsed` avec paire/taux/date/source horodatés, `skippedForMissing
RateCount`). Tout est répercuté dans `AnalysisResult.marketEvidence`
(`@dealradar/contracts`) via des champs ADDITIONNELS optionnels — jamais
une régression pour un appelant qui construirait encore la forme du lot
précédent. Aucune donnée sensible exposée (taux de change publics par
nature, jamais une clé/URL de fournisseur).

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

1. **Activation des credentials** (Keepa/BrickLink/PriceCharting/SerpApi/
   DataForSEO/Zyte) — les six connecteurs de marché + le fournisseur de
   scraping sont entièrement construits, testés et câblés jusque dans le
   pipeline d'analyse générique, avec conversion FX automatique déjà
   opérationnelle ; il ne manque que des secrets réels pour passer de
   "NOT TESTED live" à un premier flux réel multi-source de bout en bout.
2. **Router les taux FX effectivement résolus vers `persistFxRate`** pour
   un audit traçable en base (table `fx_rates` déjà générique et prête) —
   `orchestrateMarketIntelligence` ne fait aujourd'hui que CONVERTIR via le
   `FxRateProvider`, jamais persister les taux utilisés.
3. **Réévaluer StockX/WatchCharts/TCGplayer si le contexte change** — StockX
   si DealRadar noue une relation vendeur, WatchCharts si une licence de
   Distribution/Revente est négociée ET que la documentation technique
   redevient consultable, TCGplayer si un accès partenaire s'ouvre. Aucun
   des trois n'est un blocage technique résolvable par du code — un
   changement de statut d'accès/licence est un préalable à toute
   implémentation, pas une question d'ingénierie.
