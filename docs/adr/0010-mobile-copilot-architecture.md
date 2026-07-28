# ADR 0010 — Mobile Copilot & Universal Listing Analysis (Lot 1)

**Statut** : accepté (spikes) / proposé (V1 complète) · **Date** : 2026-07-27

## Contexte

DealRadar cesse d'être conçu uniquement comme un agrégateur d'annonces. La
promesse produit devient : « où que l'utilisateur trouve un objet
d'occasion, DealRadar lui indique en quelques secondes ce qu'il vaut
réellement, quelle marge nette il peut espérer, avec quel niveau de
confiance ». Ce lot pose les fondations : audit de préparation, contrat
d'analyse universel, documentation de conformité/confidentialité/menaces,
et deux spikes techniques prouvant que les flux Android/iOS envisagés sont
réellement store-compliant — pas simulés.

## Ce que ce lot ne construit pas

Paiements, abonnements réels, second provider IA, nouveau connecteur
marketplace, scraping Facebook/Anibis, `AccessibilityService`, analyse
permanente de l'écran, ReplayKit de production, publication sur les stores,
refonte du site, fonctionnalités sociales. Voir `docs/mobile/readiness-audit.md`
pour le détail de ce qui existe déjà et de ce qui est nouveau dans ce lot.

## Pourquoi le produit devient un assistant d'achat

La V1 web répondait à « quelles annonces existent ». Elle ne répond pas à
« cet objet précis, sous mes yeux, vaut-il le coup ». La seconde question
est celle qui se pose au moment de la décision d'achat — dans Facebook
Marketplace, Anibis, en brocante — jamais dans DealRadar lui-même. D'où la
nécessité d'un point d'entrée qui suit l'utilisateur hors de l'app.

## Pourquoi Android et iOS ont des expériences différentes

Android autorise un overlay persistant par-dessus d'autres applications
(`SYSTEM_ALERT_WINDOW`) et une capture ponctuelle d'écran consentie
(`MediaProjection`). iOS n'offre aucun équivalent conforme aux règles Apple
— la seule voie store-compliant pour recevoir le contenu d'une autre
application est que l'utilisateur partage explicitement via la feuille de
partage système (Share Extension). Simuler un overlay sur iOS via des
techniques non supportées (SnapKit sur une fenêtre superposée custom,
détournement de ReplayKit) serait un motif de rejet App Store quasi
certain. Les deux expériences ci-dessous sont donc **volontairement
asymétriques**, chacune alignée sur ce que sa plateforme autorise :

- **Android** : bulle flottante → déclenchement conscient → capture ponctuelle → analyse.
- **iOS** : partage explicite (URL, texte, image, capture) → analyse.

## Pourquoi l'accessibilité Android n'est pas utilisée en V1

`AccessibilityService` permettrait une inspection continue de l'écran sans
capture explicite, mais c'est précisément l'usage que Google Play qualifie
d'à haut risque de rejet quand la fonction annoncée (analyse d'annonces) ne
relève pas d'une assistance d'accessibilité réelle. Utiliser cette API
comme raccourci technique contredirait aussi la règle produit absolue :
« aucune surveillance silencieuse ». **Hors périmètre, classé comme risque
fort de refus Google Play** — voir `docs/mobile/android-permissions.md`.

## Pourquoi ReplayKit n'est pas une dépendance de la V1

ReplayKit (capture ou diffusion d'écran iOS) pourrait théoriquement
remplacer le Share Extension pour un usage plus proche de l'Android, mais
il implique une diffusion continue plutôt qu'une capture ponctuelle
consentie, un risque de review Apple plus élevé, et n'est nécessaire à
aucun flux de ce lot. Il reste une expérimentation future non bloquante
pour la V1 iPhone (`docs/mobile/ios-share-extension.md`).

## Pourquoi la capture est ponctuelle et déclenchée

Règle absolue : aucune capture n'a lieu sans une action utilisateur
explicite (tap sur la bulle, ou partage depuis la feuille système). Aucun
service ne lit l'écran en continu. Un indicateur visible (notification de
premier plan Android, indicateur système iOS pendant tout partage) reste
affiché tant qu'une capture est possible. C'est une contrainte produit,
pas seulement technique — vérifiable dans le spike Android par absence de
tout appel de capture hors du gestionnaire de clic de la bulle.

## Stack mobile : Expo + Development Build

**Décision : Expo avec Development Build (config plugins + `expo prebuild`),
ni Expo Go, ni React Native bare complet.**

- Expo Go ne peut héberger aucun module natif custom : ni overlay
  `SYSTEM_ALERT_WINDOW` + `MediaProjection` + foreground service côté
  Android, ni cible Share Extension côté iOS. Une V1 en Expo Go managé est
  donc techniquement impossible pour ce produit — hypothèse fausse à
  écarter explicitement plutôt qu'à simuler.
- React Native bare fonctionnerait, mais abandonnerait sans contrepartie
  l'outillage de config plugins / prebuild d'Expo, alors qu'un
  Development Build obtient exactement le même accès natif en gardant cet
  outillage et une seule base de code JS partagée Android/iOS.
- Le code spécifique à chaque plateforme reste isolé dans des modules
  (`apps/mobile/modules/overlay-copilot` côté Android) et des config
  plugins (`apps/mobile/plugins/withAndroidOverlayCopilot.js`,
  `withIosShareExtension.js`) — jamais mélangé dans le code JS partagé.

Une seule application `apps/mobile`, pas deux applications séparées : les
deux plateformes partagent l'essentiel de l'UI (écrans, appel API,
gestion du résultat), seule la couche de capture/réception diffère.

## Limite d'environnement assumée pour ce lot

Ce lot a été produit sur une machine Windows sans Xcode/macOS et sans SDK
Android préinstallé. Conséquences documentées sans les masquer :

- **iOS** : le plugin de config et la cible Share Extension
  (`ios/ShareExtension/ShareViewController.swift`) sont écrits mais **jamais
  compilés ni exécutés** dans ce lot — nécessite un Mac (local ou EAS Build)
  et un compte Apple Developer pour signature. Voir verdict final.
- **Android** : un SDK/émulateur a été installé pour ce lot et réellement
  exercé — voir `docs/mobile/readiness-audit.md` pour le détail complet.
  Résumé : l'émulateur démarre et boote réellement (accélération WHPX
  disponible, confirmé par `adb`/`getprop`), le config plugin produit un
  manifeste correct (vérifié, pas relu), et le module Kotlin
  `overlay-copilot` compile avec succès après correction de plusieurs bugs
  réels trouvés à la compilation (migration vers l'API Expo Modules,
  ordre d'initialisation, masquage de propriété, conflit de version
  Kotlin). Le lien final de l'APK reste bloqué par une limite Windows
  authentique (chemins pnpm dépassant `MAX_PATH`), nécessitant l'activation
  des chemins longs Windows — un changement système que cette session
  d'outillage n'a pas les droits d'appliquer elle-même.

## Précision — pourquoi `analyzeListing()`/`extractListing()` ne sont pas réutilisés verbatim

Constat fait en implémentant plutôt qu'en supposant : `extractListing()` et
`analyzeListing()` (`packages/ingestion`) sont façonnés autour d'un
`listingId` — une ligne déjà présente dans `public.listings`, alimentée
aujourd'hui uniquement par l'ingestion eBay. Une capture d'écran ou une
photo soumise par le mobile n'est **pas** une ligne `listings` : lui en
créer une artificiellement détournerait une table dont le sens est
« annonce marketplace ingérée » pour y loger un objet de nature différente.

Le job `analysis.process` appelle donc directement les deux primitives
pures qui n'ont, elles, aucune dépendance à `listings` : `extractProduct()`
(`packages/ai`) pour l'extraction, et `runIntelligencePipeline()`
(`packages/core`) pour la décision — exactement ce qu'`extractListing()`/
`analyzeListing()` appellent en interne, sans la couche d'orchestration
propre à l'ingestion marketplace. Les comparables candidats sont lus
directement dans `public.listings`/les ventes déjà persistées, filtrés par
catégorie/marque identifiée, via `mapListingToIntelligence()`/
`mapSoldRowToComparable()` (`packages/ingestion/src/map-to-intelligence.ts`)
déjà génériques sur la forme de la ligne — réutilisés tels quels, pas
réécrits. Aucune logique de score, d'extraction ou de normalisation n'est
dupliquée ; seule la couche d'orchestration spécifique à l'ingestion
marketplace est contournée, parce qu'elle ne correspond pas à ce cas
d'usage.

## Contrat d'analyse universel

`POST /v1/analyses` / `GET /v1/analyses/:id` (détail complet dans
`docs/mobile/api-contract.md`) — un seul contrat pour web, Android, iOS,
extension de partage, alertes e-mail futures, agents futurs. La plateforme
d'origine (`sourcePlatform`) est une métadonnée, jamais une entrée qui
contamine Intelligence Core : le pipeline d'extraction et de décision ne
sait pas d'où vient la requête, seulement quel type de source
(`sourceType`) et quelles données il a reçues.

## Stratégie de réduction des coûts — deux caches, pas un appel IA par clic

Réutilise intégralement l'infrastructure existante, ne la duplique pas :

- **Cache annonce** : identité par empreinte de capture/URL/contenu
  partagé — réutilise `packages/ai/src/cache/image-fingerprint.ts` et
  `compute-key.ts` déjà existants.
- **Cache produit partagé** : `packages/ai/src/cache/*` +
  `packages/ingestion/src/ai-cache-supabase.ts` (table
  `ai_extraction_cache`, migration 0011) — déjà conçu pour ne jamais
  inclure d'identité utilisateur dans sa clé. Aucune seconde table de cache
  produit n'est créée dans ce lot.
- Le pipeline obligatoire (cache exact → cache produit → déterministe →
  IA texte → vision) est exactement celui que `packages/ai` implémente déjà
  pour l'ingestion eBay (ADR 0009) ; le worker mobile
  (`apps/workers/src/jobs/process-analysis.ts`) l'appelle tel quel, il ne
  le réimplémente pas.

## Séparation extraction / décision

Le contrat de résultat mobile est une enveloppe Zod autour des types déjà
produits par Intelligence Core (`Decision`, `IntelligenceScores`,
`WhyPanelInput`/sortie, `CostInputs` — `packages/core/src/intelligence/types.ts`),
pas un nouveau moteur de décision. `packages/ai` continue de n'exprimer
aucun jugement de valeur (règle absolue de l'ADR 0009, inchangée) ;
Intelligence Core (ADR 0007) reste seul responsable de `BUY` / `REVIEW` /
`PASS` / `INSUFFICIENT_DATA`.

## Limites des données de marché

Le résultat distingue explicitement `sold_transaction`, `market_guide`,
`active_listing`, `retail_price`, `estimated_value`, `unknown` — jamais
d'affichage de « dernières ventes » si la seule source disponible est un
guide de prix ou des annonces actives (contrainte déjà respectée par
Intelligence Core aujourd'hui, simplement exposée au client mobile sans
being reformulée).

## Risques App Store / Play Store

Détaillés dans `docs/mobile/store-compliance.md` et
`docs/mobile/threat-model.md`. Risques principaux : `SYSTEM_ALERT_WINDOW`
et `MediaProjection` nécessitent une justification claire dans la fiche
Play (finalité, consentement, alternative moins sensible) ; la Share
Extension iOS doit démontrer qu'elle ne traite que ce que l'utilisateur
partage volontairement, sans inspection silencieuse d'autres applications.

## Compromis retenus

- Un seul repo/app mobile plutôt que deux, au prix d'une couche
  d'abstraction de capture par plateforme.
- Rate limiting cloné du pattern de budget IA atomique existant
  (verrou consultatif Postgres) plutôt qu'une nouvelle dépendance (Redis) —
  cohérent avec l'infrastructure déjà en place.
- Spike iOS non vérifié dans ce lot, assumé et documenté, plutôt que
  simulé avec des mocks présentés comme une validation native.

## Hors périmètre

Voir section 19 du brief produit — non répété ici pour éviter la
duplication avec `docs/mobile/readiness-audit.md`.
