# Audit sources libres/gratuites + réalité de préparation + tests de fumée live

LOT "Free/Open Sources + Real Readiness + Live Smoke Tests". Conclusions de
conformité VÉRIFIÉES (appel réel quand possible, ou documentation officielle
actuelle citée) pour chaque source auditée ce lot — jamais une supposition,
jamais un statut "gratuit pour la production" affirmé sans preuve. Aucune
credential de valeur n'apparaît dans ce document.

## Comment lire ce document

Quatre classes explicites (voir aussi `FreeClass` dans
`packages/connectors/src/market-intelligence/source-readiness-matrix.ts`,
source de vérité machine-lisible — ce document en est le rapport narratif) :

- **FREE/OPEN** — aucune clé, aucune restriction commerciale pertinente.
- **FREE-TIER** — gratuit mais borné par un débit/quota réel.
- **FREE ACCOUNT/KEY REQUIRED** — gratuit, inscription en libre-service, usage commercial permis.
- **COMMERCIAL APPROVAL REQUIRED / POLICY DEFERRED** — statut non tranché avec certitude, décision humaine requise avant activation.

## 1. Sources d'identité/catalogue implémentées ce lot

### Open Food Facts / Open Products Facts — **FREE/OPEN**

- Docs : `world.openfoodfacts.org/api/v2/product/{barcode}.json`, aucune clé pour une lecture.
- Licence ODbL — clause de partage à l'identique (§4.4/§4.5(b) ODbL) applicable à une **Derivative Database republiée**, JAMAIS à un **Produced Work** qui affiche le résultat d'une requête (ce que fait DealRadar). Attribution requise (mention + lien openfoodfacts.org) — coût réel mais faible.
- **Appel réel effectué ce lot** : `3017620422003` (Nutella) → trouvé ; `0000000000000` → `"no code or invalid code"` ; `8710447452746` (Open Products Facts) → `"product not found"`.
- **Trouvaille réelle d'audit** : `3014230021404` sur Open Products Facts renvoie `status: 0` avec `"product found with a different product type: beauty"` — le code EXISTE mais appartient à un projet frère distinct (Open Beauty Facts). Jamais traité comme une correspondance par le connecteur (`isOpenFactsMatch`).
- Couverture Open Products Facts nettement plus clairsemée qu'Open Food Facts (plusieurs codes-barres génériques plausibles testés, introuvables).
- Aucune limite de débit numérique publiée officiellement trouvée — `User-Agent` explicite envoyé par précaution.

### Rebrickable — **FREE ACCOUNT/KEY REQUIRED**

- `REBRICKABLE_API_KEY` absente de cet environnement ce lot — **aucun appel authentifié réel possible**. Confirmé par appel réel SANS clé : `401 Unauthorized`, `www-authenticate: Key` (confirme le schéma `Authorization: key <clé>`).
- Conditions d'utilisation (`rebrickable.com/terms/`) : usage commercial **explicitement permis**. Restrictions étroites uniquement (ne pas contourner leur marketplace MOC Premium, ne pas faire concurrence directe à leur activité d'instructions) — aucune ne s'applique à DealRadar.
- ~1 requête/seconde documentée, tolérance de rafale limitée.
- Champs de réponse (`set_num`, `name`, `year`, `theme_id`, `num_parts`, `set_img_url`, `set_url`) issus de la forme publiquement documentée/stable de longue date — **jamais confirmés par un appel réel ce lot**, honnêtement marqué `liveTested: false`.

### Wikidata — **FREE/OPEN**

- CC0 confirmé (`wikidata.org/wiki/Wikidata:REST_API`), aucune clé, aucune attribution légalement requise.
- **Appel réel effectué ce lot** : requête SPARQL exacte sur `wdt:P3962` (GTIN) pour `00640520098905` → `Q29972750`, "Apple iPhone 7 128GB Jet Black", fabricant "Apple Inc."
- Lookup EXACT par identifiant uniquement (jamais de recherche SPARQL large — règle absolue du lot). Couverture GTIN clairsemée hors grandes marques (confirmé en testant plusieurs GTIN aléatoires : résultats vides).
- Étiquette opérationnelle Wikimedia : requêtes sérielles, `User-Agent` avec contact obligatoire (sous peine de palier de débit restrictif anti-scraper), backoff sur 429.

### IGDB — **COMMERCIAL APPROVAL REQUIRED / POLICY DEFERRED**

- Documentation primaire (`api-docs.igdb.com`) **inaccessible pendant l'audit (403)** — conditions exactes (frais, part de revenu, ou simple approbation) **non confirmées**.
- Mécanisme d'authentification **confirmé par appel réel** : `POST id.twitch.tv/oauth2/token` (client_credentials) ; `POST api.igdb.com/v4/games` sans authentification valide documente explicitement les en-têtes requis (`Client-ID`, `Authorization: Bearer <token>`) dans son message d'erreur.
- Position publique cohérente (forum développeur Twitch, Twitch Developer Services Agreement) : palier gratuit pour usage **non-commercial/hobby** ; un usage commercial en production avec de vrais utilisateurs semble attendu de contacter `partner@igdb.com` pour un accord séparé.
- **Décision** : implémenté (connecteur + tests, section 7), mais `productionAllowed: false` dans `source-readiness-matrix.ts` — jamais activé sans confirmation humaine explicite des conditions réelles.

### Open Prices — **FREE/OPEN** (traité comme une source complémentaire à faible confiance)

- Projet frère d'Open Food Facts, même licence ODbL — **même analyse "Produced Work"** que ci-dessus : afficher une observation de prix individuelle à un utilisateur n'est jamais une republication de la base, jamais un déclenchement de la clause de partage à l'identique.
- **Appel réel effectué ce lot** : `GET /api/v1/prices?product_code=1541513213246&page_size=2` → 3 observations réelles (prix 27.70 EUR, magasin "L'Éléfàn" à Grenoble, dates 2023-11-27 et 2025-12-31).
- Implémenté comme **MarketSource** (jamais un Catalog Connector — c'est un PRIX, contrairement aux 4 autres sources ci-dessus) : `evidenceType` TOUJOURS `"retailPrices"`, `evidenceTier` TOUJOURS `"E"` (le plus bas) — un prix scanné en magasin par un contributeur communautaire n'est ni une vente confirmée ni une annonce active.
- Projet plus jeune/moins mature qu'Open Food Facts (moins de données, schéma moins stable dans le temps) — traité comme un signal complémentaire, jamais une source de prix primaire.

### TCGdex (amélioré, pas nouveau) — **FREE/OPEN**

- Déjà implémenté (ADR 0012/LOT 7B), licence MIT confirmée. Ce lot (section 2) expose des champs DÉJÀ récupérés par le schéma mais jamais surfacés avant : agrégats de prix tiers Cardmarket/TCGplayer (`priceHints`, jamais une vente confirmée), variantes réellement possédées, illustrateur.
- **Ajouté RÉTROACTIVEMENT à `source-readiness-matrix.ts` ce lot** — n'y figurait jamais avant, malgré une implémentation antérieure à ce lot.

## 2. Sources explicitement différées (section 8 du brief — aucun effort d'implémentation dépensé)

### Pokémon TCG API — **POLICY DEFERRED (fin de vie confirmée)**

**Trouvaille réelle d'audit ce lot** : `docs.pokemontcg.io` affiche
*"New account registrations are no longer available. Existing API keys
will continue to function through March 1, 2027"*, et redirige vers une
migration Scrydex. Confirmé aussi par appel réel : `api.pokemontcg.io/v2/cards`
répond actuellement `500 Internal Server Error`. Le connecteur
PRÉEXISTANT dans ce dépôt (`catalogs/pokemon-tcg/`) n'est PAS retiré
(peut continuer de fonctionner pour une clé déjà émise), mais aucun
nouvel effort d'intégration ni nouvelle inscription — TCGdex couvre déjà
ce rôle, sans échéance de fin de vie.

### BoardGameGeek, MusicBrainz (commercial), Open Library (backend haut trafic)

Non audités en détail ce lot (hors scope de DealRadar — aucune catégorie
actuelle ne les rendrait directement utiles) — conservés comme candidats
roadmap uniquement, conformément à l'instruction explicite du brief de ne
pas y dépenser d'effort d'implémentation.

## 3. Fournisseurs IA free-tier — audit (section 9)

`Groq` et `OpenRouter` ont déjà une implémentation complète de
`AIProvider` (lots précédents) — ce lot est un AUDIT de leurs conditions
actuelles, pas une nouvelle intégration.

- **Groq — FREE-TIER, favorable à la confidentialité des photos utilisateur.** Palier gratuit réel (pas un crédit d'essai qui expire), rate-limité par organisation. Position confirmée (conditions de service/politique de confidentialité Groq) : pas d'entraînement sur les entrées/sorties client par défaut, logs temporaires (30 jours max) pour l'abus/la fiabilité uniquement, Zero Data Retention disponible. Le roster de modèles vision a changé cette année (vérifier `/openai/v1/models` en direct plutôt que supposer un modèle figé).
- **OpenRouter — FREE-TIER, mais un point de vigilance RÉEL non résolu.** Limites confirmées (FAQ officielle) : 20 req/min sur les modèles `:free`, 50/jour sous 10$ de crédits achetés cumulés, 1000/jour au-delà. Le roster de modèles vision `:free` change fréquemment (jamais coder en dur un nom de modèle précis). **Point non résolu** : des sources secondaires (jamais confirmées contre le texte officiel OpenRouter directement) suggèrent que l'usage des modèles `:free` pourrait nécessiter d'activer l'entraînement/la journalisation côté compte — un risque réel pour DealRadar qui transmet des photos utilisateur. **Recommandation** : vérifier ce point directement dans le tableau de bord/les conditions OpenRouter avant de router du trafic photo réel vers un modèle `:free`, préférer Groq ou un palier payant/ZDR OpenRouter en attendant.
- **Aucun nouveau fournisseur ajouté ce lot** (Gemini/Google AI Studio audité par recherche mais jamais intégré — Groq+OpenRouter couvrent déjà le rôle "fallback zéro-coût", ajouter un 3e fournisseur pour ce lot n'a pas été jugé justifié par une valeur suffisamment distincte).

## 4. Tests de fumée LIVE réellement exécutés ce lot (section 13)

Requêtes bornées, un seul produit connu par source, aucune credential de
valeur imprimée, aucun crawl. **Toutes exécutées directement depuis cette
session** (réseau sortant confirmé disponible) :

| Source | Requête | Résultat | Latence perçue |
| --- | --- | --- | --- |
| **Open Food Facts** | `GET /api/v2/product/3017620422003.json` | **LIVE PASSÉ** — `status:1`, "Nutella", marque "Nutella, Ferrero", quantité "400 g e" | Quelques centaines de ms |
| **Open Food Facts** (code invalide) | `GET /api/v2/product/0000000000000.json` | **LIVE PASSÉ** — `status:0`, `"no code or invalid code"` (comportement attendu, pas une erreur) | idem |
| **Open Products Facts** | `GET /api/v2/product/3450970084468.json` | **LIVE PASSÉ** — `status:1`, "GEL WC blancheur avec javel" | idem |
| **Open Products Facts** | `GET /api/v2/product/3014230021404.json` | **LIVE PASSÉ** (trouvaille réelle) — `status:0`, "found with a different product type: beauty" | idem |
| **Wikidata SPARQL** | `wdt:P3962 "00640520098905"` | **LIVE PASSÉ** — `Q29972750`, "Apple iPhone 7 128GB Jet Black", fabricant "Apple Inc." | ~1s |
| **Open Prices** | `GET /api/v1/prices?product_code=1541513213246` | **LIVE PASSÉ** — 3 observations, 27.70 EUR, magasin réel identifié | Quelques centaines de ms |
| **Rebrickable** | `GET /lego/sets/6608-1/` sans clé | **LIVE PASSÉ (mécanisme d'auth uniquement)** — `401`, `www-authenticate: Key` confirme le schéma ; **AUCUNE donnée de set réelle obtenue** (`REBRICKABLE_API_KEY` absente) | — |
| **IGDB** | `POST /v4/games` sans token, `POST id.twitch.tv/oauth2/token` avec identifiants invalides | **LIVE PASSÉ (mécanisme d'auth uniquement)** — messages d'erreur confirmant le schéma exact ; **AUCUNE donnée de jeu réelle obtenue** (`IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` absentes) | — |
| **eBay / SerpApi / JustTCG / Frankfurter / TCGdex (recherche)** | — | **NOT TESTED** — `activation-preflight` confirme toutes les credentials correspondantes absentes de cet environnement ce lot (voir `docs/beta-readiness.md`, section 4) | — |

**Aucune réclamation de succès Railway** — ces tests de fumée sont tous des
appels réseau directs depuis CETTE session locale, jamais depuis le worker
Railway (hors ligne, voir section 5 ci-dessous).

## 5. Audit Railway (section 14)

**NOT TESTED.** Aucun accès au connecteur Railway dans cette session —
confirmé indirectement par `pnpm --filter @dealradar/workers activation-preflight`
(`migrations.status: "NOT_TESTED"`, aucune connexion Supabase/Railway
disponible). Les noms de variables NOUVELLEMENT pertinents si ce lot est
activé, à provisionner sur Railway le moment venu (JAMAIS de valeur ici) :

- `REBRICKABLE_API_KEY`
- `IGDB_CLIENT_ID`
- `IGDB_CLIENT_SECRET`

Aucune valeur factice/vide ajoutée nulle part. Aucun nom retiré des
variables déjà connues (`SERPAPI_KEY`, `EBAY_CLIENT_ID`/`SECRET`,
`JUSTTCG_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, variables
Supabase) — toutes restent pertinentes, aucune n'a été retirée ou
remplacée par ce lot.

## 6. Préparation non-Production (section 15) — complète le runbook existant

`docs/market-data-activation-checklist.md` (Stage A→E) reste le runbook de
référence — ce lot n'ajoute AUCUNE nouvelle migration (0017→0026
inchangées). Étapes AJOUTÉES pertinentes pour les nouvelles sources :

**Stage B′ — Tests de fumée par source, sources ajoutées ce lot**
- Open Food Facts/Open Products Facts/Wikidata/Open Prices : déjà testables SANS aucune credential — exécuter directement, comme démontré section 4 ci-dessus.
- Rebrickable : nécessite `REBRICKABLE_API_KEY` (inscription gratuite, rebrickable.com) — puis confirmer la forme de réponse réelle contre `raw-types.ts` (jamais supposée correcte sans ce test).
- IGDB : nécessite `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` (app Twitch Developer) — **ET** une clarification écrite de `partner@igdb.com` sur les conditions commerciales exactes AVANT tout `productionAllowed: true` dans `source-readiness-matrix.ts`, quel que soit le résultat technique du test de fumée.

**Stage F — Revue de licence humaine finale (nouveau ce lot)**
- Confirmer par une lecture humaine indépendante la conclusion ODbL "Produced Work" de ce document (sections 1) avant tout affichage à grande échelle de données Open Food Facts/Open Prices à des utilisateurs payants — l'analyse ci-dessus est une lecture de texte de licence par l'agent, jamais un avis juridique engageant.
- Décider explicitement si IGDB vaut la démarche `partner@igdb.com` avant d'investir davantage dans la verticale gaming, ou si elle reste un connecteur dormant (`productionAllowed: false` indéfiniment).

## 7. Addendum — LOT "Live Identity Enrichment + Barcode-First + upc.dev Fallback + Railway Readiness"

Ce lot WIRE enfin les sources ci-dessus dans le chemin générique réel
(`process-analysis.ts` — voir `packages/ingestion/src/enrich-product-
identity.ts`), et audite/implémente un repli barcode supplémentaire :
**upc.dev**.

### 7.1 upc.dev (section 3 du brief) — AUDITÉ AVANT implémentation, puis IMPLÉMENTÉ

Conditions d'utilisation lues (`upc.dev/terms`, `upc.dev/pricing`,
`upc.dev/openapi.json`) AVANT tout code :
- **Usage commercial** : explicitement permis — *"You get a perpetual
  license to use responses in your product. You can cache, display, and
  derive from the data."*
- **Restriction pertinente unique** : jamais un dump brut en masse
  redistribué (*"You can't redistribute raw bulk dumps"*) — aucune
  pertinence pour un lookup exact à la fois.
- **Palier gratuit** : 100 requêtes/jour, clé en libre-service
  (`POST /v1/auth/register`), en-tête `X-API-Key`.
- **Appels RÉELS effectués ce lot** (accès public sans clé, palier "basic
  data" — suffisant pour confirmer la forme de réponse) : `049000042566`
  (Coca-Cola) → succès, **`image_url` pointe vers
  `images.openfoodfacts.org`** — confirmation directe qu'upc.dev RÉAGRÈGE
  des sources ouvertes déjà connectées directement par DealRadar (Open
  Food Facts), jamais une base indépendante pour ce genre de produit.
  `1234567890123` (fixture "Test product API" bien connue d'Open Food
  Facts) → même conclusion. `000000000000` → `404`
  `{"code":"INVALID_UPC"}` (PAS un code "NOT_FOUND" distinct malgré ce que
  suggère la doc OpenAPI publique). Un appel a aussi renvoyé `503` à corps
  TEXTE BRUT (*"upc.dev is warming this page..."*) pendant une fenêtre de
  démarrage à froid — traité comme un `5xx` retryable ordinaire par le
  client (`packages/connectors/src/catalogs/upcdev/client.ts`), jamais un
  crash de parsing JSON.

**Verdict : IMPLÉMENTÉ**, comme repli de **second rang uniquement**
(`identity-source-routing.ts` : jamais consulté avant Open Food Facts/Open
Products Facts/Wikidata, exactement parce que le chevauchement avec Open
Food Facts est confirmé en direct — l'interroger en premier gaspillerait
son quota quotidien limité sur des produits déjà couverts gratuitement).
Extraction volontairement CONSERVATRICE, même discipline qu'Open Food/
Products Facts : GTIN + capacité (motif GB/TB objectif) uniquement,
JAMAIS de marque/modèle tirés de son `name` (texte libre agrégé de
qualité par-enregistrement non vérifiée). Aucun prix — `priceHints`
jamais peuplé. `UPCDEV_API_KEY` requise pour activer (aucun appel
authentifié réel possible cette session, clé absente) — voir action
humaine ci-dessous.

### 7.2 Repli barcode supplémentaire — UPCitemdb / Go-UPC / Barcode Lookup (section 4 du brief)

Audit bref, AUCUNE implémentation :

- **Go-UPC** : **aucun palier gratuit** (`go-upc.com/plans` — le plan le
  moins cher est 74,95 $/mois). Disqualifié immédiatement (le brief exige
  "meaningful free quota").
- **Barcode Lookup** (`barcodelookup.com/api`) : page renvoie `403
  Forbidden` à une lecture directe — conditions non auditables proprement
  cette session, connu par ailleurs pour nécessiter un plan payant pour un
  usage réel.
- **UPCitemdb** (`devs.upcitemdb.com`) : palier gratuit comparable (100
  requêtes/jour, "Explorer", aucune inscription requise) MAIS conditions
  d'utilisation (`upcitemdb.com/terms`) n'établissent PAS clairement
  l'usage commercial du palier GRATUIT spécifiquement (le langage de
  licence lie l'usage commercial aux plans PAYANTS "Dev"/"Pro"), et
  aucune politique de cache/stockage n'y est explicite — exactement le
  type d'ambiguïté que le brief demande de NE PAS activer ("If unclear:
  do NOT activate"). De plus, aucun complément de couverture MATÉRIEL
  démontré par rapport à upc.dev (déjà implémenté ce lot, même catégorie
  d'agrégateur retail/consommateur).

**Verdict : DIFFÉRÉ pour les trois** — aucun connecteur créé, aucune
entrée `source-readiness-matrix.ts` ajoutée (précédent : les sources
différées sans connecteur du LOT "Free/Open Sources..." — BoardGameGeek/
MusicBrainz/Open Library — n'ont pas non plus d'entrée matrice). Décision
purement documentaire, aucun blocage pour ce lot.

### 7.3 TCGdex `priceHints` dans la valorisation TCG (section 6 du brief) — DIFFÉRÉ, blocage exact documenté

`extractTcgdexPriceHints` (LOT "Free/Open Sources...", `packages/
connectors/src/catalogs/tcgdex/normalize.ts:143`) peuple déjà
`CatalogItem.priceHints` (agrégats Cardmarket/TCGplayer) — mais AUCUN
consommateur n'existe dans la verticale TCG (`orchestrate-pokemon-
pipeline.ts`, `process-tcg-card-analysis.ts` : zéro référence à
`priceHints`, confirmé par recherche ce lot).

**Blocage EXACT** : consommer ce champ dans la valorisation TCG
nécessiterait de modifier `orchestrate-pokemon-pipeline.ts` et/ou
`process-tcg-card-analysis.ts` — des fichiers TCG-CRITIQUES sous la
contrainte permanente rappelée à chaque lot ("Preserve ALL existing TCG
behavior — verified after every lot via `git diff --stat` against
TCG-critical files, must show empty diff"). Un changement de
COMPORTEMENT réel (nouvelle preuve de marché consommée, même en tant que
"specialist-market evidence" additive) sur ces fichiers romprait cette
garantie, même si le changement lui-même est prudent. **Décision : garder
`priceHints` enrichissement-seul (déjà exposé, jamais consommé), différer
le branchement à un LOT DÉDIÉ qui autorise explicitement de toucher aux
fichiers de valorisation TCG.**

Point d'intégration futur exact, si/quand autorisé : dans
`orchestrate-pokemon-pipeline.ts`, après la résolution TCGdex existante
(déjà appelée pour l'identité de la carte) — mapper
`catalogItem.priceHints` (filtré `source ∈ {"cardmarket","tcgplayer"}`)
en preuve de marché de tier spécialiste (jamais une vente conclue
individuelle, jamais un doublon avec JustTCG déjà consulté séparément —
nécessiterait une clé de dédoublonnage explicite par `source`+`variant`
avant fusion).

### 7.4 Tests de fumée live — sources ACTUELLEMENT configurées sur Railway (section 7 du brief)

Distinction absolue maintenue : **présence d'un nom de variable sur
Railway** ≠ **validité de la credential** ≠ **test réseau local (cette
session)** ≠ **succès en environnement d'exécution Railway réel**. Cette
session n'a accès à AUCUNE credential Railway — seules les sources SANS
clé sont donc testables ici ; toutes les autres sont honnêtement NOT
TESTED, jamais présentées comme validées.

| Source | Credential Railway | Testable cette session ? | Résultat (appel réel, ce lot) |
|---|---|---|---|
| TCGdex | aucune (sans clé) | oui | **PASSED** — `GET /v2/en/cards/base1-4` → `200`, `"Charizard"` |
| Frankfurter (FX) | aucune (sans clé) | oui | **PASSED** — `GET /v1/latest?base=USD&symbols=CHF` → `200`, `0.82141` |
| Open Food Facts | aucune (sans clé) | oui | **PASSED** — `GET /api/v2/product/3017620422003.json` → `200`, "Nutella" |
| Open Products Facts | aucune (sans clé) | oui | **PASSED (service up)** — `GET /api/v2/product/3760020509370.json` → `404` applicatif pour ce code précis, cohérent avec la couverture clairsemée déjà documentée (section 3 du corps de ce document) ; le SERVICE répond, jamais une panne. |
| Wikidata | aucune (sans clé) | oui | **PASSED** — SPARQL `wdt:P3962` sur `00640520098905` → 1 résultat, "Apple iPhone 7 128GB Jet Black" |
| Open Prices | aucune (sans clé) | oui | **PASSED** — `GET /api/v1/prices?product_code=3017620422003` → `200`, 166 prix au total |
| upc.dev | `UPCDEV_API_KEY` (absente Railway ET ici) | partiellement — accès PUBLIC sans clé seulement | **PASSED (accès public uniquement)** — voir section 7.1 ; aucun appel AUTHENTIFIÉ testé |
| Rebrickable | `REBRICKABLE_API_KEY` (absente Railway ET ici) | non | **NOT TESTED** — aucune credential disponible |
| IGDB | `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` (absentes) | non, et verrouillé par politique de toute façon | **NOT TESTED** (`productionAllowed: false`) |
| eBay | `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`/... (Railway : présentes, ici : absentes) | non | **NOT TESTED** — présence Railway ≠ credential testable ici |
| SerpApi / Google Shopping | `SERPAPI_KEY` (Railway : présente, ici : absente) | non | **NOT TESTED** |
| JustTCG | `JUSTTCG_API_KEY` (Railway : présente, ici : absente) | non | **NOT TESTED** |
| OpenAI / Anthropic | `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (Railway : présentes, ici : absentes) | non (présence-only, jamais un appel réel de génération dans un audit de source) | **NOT TESTED** |

Aucune valeur de credential imprimée nulle part dans ce document ou dans
le code — uniquement PRÉSENT/ABSENT par nom de variable.

### 7.5 Couche de cache / limitation de débit (section 11 du brief)

Implémentée ce lot : `apps/workers/src/ingestion/catalog-source-factory.ts`
(`wrapCatalogLookupWithCache`/`createCachedCatalogLookup`/
`sharedCatalogLookupCache`) — cache PARTAGÉ au niveau processus (même
précédent que `sharedFxRateProvider`, `fx-provider.ts`), clé par source +
identifiant EXACT, jamais un texte flou. TTL positif réutilisé TEL QUEL
depuis le `cachePolicy.ttlHours` déjà déclaré par chaque connecteur
(jamais une seconde politique de durée dupliquée) :

| Source | TTL positif (déjà déclaré par le connecteur) | TTL négatif ("non trouvé") |
|---|---|---|
| Open Food Facts | 24 h | 24 h (plafond commun) |
| Open Products Facts | 24 h | 24 h |
| Wikidata | 168 h (7 jours) | 24 h (plafonné, jamais 168 h — un "non trouvé" doit pouvoir redevenir vrai plus tôt) |
| Rebrickable | 168 h (7 jours) | 24 h (plafonné) |
| upc.dev | 720 h (30 jours, mise en cache "agressive" explicitement demandée par le brief) | 24 h (plafonné) |

Taille bornée à 2000 entrées (éviction FIFO) — jamais une croissance
mémoire illimitée sur un worker de longue durée. Une PANNE (exception)
n'est jamais mise en cache — seul un résultat RÉEL (positif ou négatif)
l'est. Un connecteur dont `license.allowsCaching` serait `false` (aucun
cas aujourd'hui) ne serait jamais mis en cache, quel que soit le résultat.
Le 429/backoff par source reste géré INDIVIDUELLEMENT par chaque client
HTTP (déjà en place depuis le LOT F) — cette couche réduit seulement le
VOLUME d'appels répétés pour un même identifiant, jamais une seconde
couche de retry.

## Actions humaines EXACTES restantes (priorisées)

1. **Décision de principe, aucun coût** : rien ne bloque l'activation d'Open Food Facts/Open Products Facts/Wikidata/Open Prices dès aujourd'hui — aucune credential, licence déjà audit­ée comme compatible. Le pipeline générique réel les consulte déjà (LOT "Live Identity Enrichment...", `enrich-product-identity.ts`).
2. **Créer un compte Rebrickable gratuit** (`REBRICKABLE_API_KEY`) pour confirmer la forme de réponse réelle et activer l'enrichissement LEGO.
3. **Créer un compte upc.dev gratuit** (`UPCDEV_API_KEY`, `POST /v1/auth/register`) pour activer le repli barcode de second rang et confirmer un appel AUTHENTIFIÉ réel (seul le palier public "basic data" a pu être testé cette session).
4. **Contacter `partner@igdb.com`** avant toute activation Production d'IGDB, quelle que soit la valeur perçue de la verticale gaming — ne jamais activer sur la seule base d'une credential technique valide.
5. **Vérifier le comportement d'entraînement/journalisation des modèles `:free` OpenRouter** directement dans le tableau de bord OpenRouter avant de router du trafic photo utilisateur réel par ce chemin.
6. **Revue de licence humaine** des conclusions ODbL de ce document avant un affichage à grande échelle — voir Stage F ci-dessus.
