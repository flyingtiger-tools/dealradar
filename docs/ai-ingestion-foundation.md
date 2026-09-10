# Fondations IA / ingestion — état, préparation, prochaines étapes

Document de référence pour ce lot (`feat/reprise-ai-ingestion-foundation`, branché sur
`chore/lint-scripts-exclusion`, lui-même sur `main` à `0231ddd`). Statuts utilisés dans
tout ce document — jamais une formulation ambiguë :

- **IMPLEMENTED** — code réel, exécuté par le pipeline de production.
- **MOCK-TESTED** — testé exhaustivement contre des mocks/fakes, jamais contre un vrai
  service. Le code fonctionne, son comportement face au vrai service n'est pas prouvé.
- **PREPARED** — types/interfaces/primitives écrits, rien n'appelle ce code depuis le
  pipeline réel.
- **NOT DEPLOYED** — aucun déploiement Railway/Vercel/Supabase déclenché pour ce lot.
- **NOT LIVE-TESTED** — jamais exécuté contre un vrai service externe dans ce lot.
- **NOT IMPLEMENTED** — n'existe pas encore, même en préparation.

## 1. Providers IA — état actuel

| Provider | Statut | Fichier | Tests |
|---|---|---|---|
| OpenAI | IMPLEMENTED, déjà en production | `packages/ai/src/provider/openai.ts` | MOCK-TESTED (4) |
| Anthropic (Claude) | IMPLEMENTED, déjà en production | `packages/ai/src/provider/claude.ts` | MOCK-TESTED (17) |
| Groq | IMPLEMENTED (code), **NOT LIVE-TESTED** | `packages/ai/src/provider/groq.ts` | MOCK-TESTED (13) |
| OpenRouter | IMPLEMENTED (code), **NOT LIVE-TESTED** | `packages/ai/src/provider/openrouter.ts` | MOCK-TESTED (15) |

Les quatre implémentent `AIProvider` (`packages/ai/src/provider/types.ts`) — interface
inchangée dans ce lot. Tous partagent `fetchWithRetry`/`ProviderError`
(`packages/ai/src/provider/http.ts` : timeout, retry+backoff borné sur 429/5xx, jamais
de retry sur 401/403), la même `COST_TABLE` (`packages/ai/src/observability/cost-table.ts`)
et la même télémétrie (`packages/ai/src/observability/telemetry.ts`).

**Groq et OpenRouter n'ont jamais été appelés en réel** — vérifié uniquement contre des
`fetch` mockés. Aucune clé réelle n'existe pour eux dans ce lot.

## 2. Ajouter un cinquième provider

1. Créer `packages/ai/src/provider/<nom>.ts`, implémenter `AIProvider` — copier
   `groq.ts` comme modèle si l'API est compatible OpenAI Chat Completions, sinon
   `claude.ts` pour un format propriétaire.
2. Réutiliser `fetchWithRetry`/`ProviderError` — jamais réimplémenter le retry/timeout.
3. Ajouter le fichier de tests mockés correspondant (`__tests__/<nom>.test.ts`) — jamais
   d'appel réseau réel dans les tests.
4. Exporter depuis `packages/ai/src/index.ts`.
5. Ajouter une branche isolée dans
   `apps/workers/src/ingestion/ai-provider-config.ts::buildAiExtractionConfigFromEnv()` —
   sa propre variable de clé, jamais un repli silencieux vers un autre provider.
6. Documenter la variable dans `.env.example`.
7. Si un tarif fiable est connu, l'ajouter à `COST_TABLE`
   (`packages/ai/src/observability/cost-table.ts`) avec sa source et sa date — sinon
   laisser le coût `null`/inconnu partout où il est calculé (jamais inventé).

## 3. Stratégie AI-LAST (ADR 0013) — rappel

Déterministe d'abord → corroboration catalogue → IA seulement si nécessaire (ambiguïté
ou absence de résultat déterministe) → modèle le moins cher qui passe un seuil de
qualité → escalade seulement si nécessaire → filet de repli explicite → télémétrie
complète. **Aujourd'hui, aucun extracteur déterministe (OCR/code-barres) n'existe pour
une photo de carte TCG** — chaque scan passe par l'IA. C'est le vrai état, documenté
honnêtement dans `packages/benchmark/src/tcg/types.ts::TcgDeterministicVsAiSummary`
plutôt que masqué.

## 4. Benchmark multi-provider

`packages/benchmark/src/tcg/` étend le package existant (jamais un second framework) —
voir `packages/benchmark/datasets/tcg/README.md` pour la procédure complète.

```bash
pnpm --filter @dealradar/benchmark bench -- --tcg
```

Statut : **MOCK-TESTED** (80 tests, mode simulé garanti par défaut). Mode réel
(`--tcg-live`) : **PREPARED, NOT LIVE-TESTED** — nécessite un flag explicite ET une
vraie clé pour le provider concerné, sinon repli automatique sur le simulé.

Métriques produites : exemples/succès/erreurs (provider/JSON/schéma), précision
d'identification exacte, précision par champ (nom/set/numéro/langue/variante — comparaison
du numéro de collection via `collectorNumbersMatch()`, jamais une égalité de texte brute :
"96" et "096" correspondent), calibration de confiance, taux de `needsConfirmation`
(calculé via `isSufficientForAutoCorroboration()`, `packages/ai/src/extraction/extract-tcg-card.ts`
— seuil 0.7, source de vérité unique partagée avec le worker réel, plus de duplication),
taux d'hallucination (couvre les 5 champs comparés pour l'exactitude ET
productKind/gradingCompany/grade), latences (avg/median/p95), coût total et coût par
identification réussie (`null` si le modèle n'a pas d'entrée fiable dans `COST_TABLE`).

## 5. Ajouter un dataset réel

Voir `packages/benchmark/datasets/tcg/README.md` — schéma de vérité terrain complet,
tags de difficulté, et la liste précise des cas à couvrir en priorité (Nymble 96/096,
zéro de tête, numéro proche, carte FR/EN, reflet, faible lumière, angle, flou, set
ambigu, variante proche). **Aucune photo réelle n'est incluse dans ce lot** — le fichier
`datasets/tcg/tcg.json` livré est un squelette vide (`entries: []`).

## 6. Stratégie future de routing (Phase 8)

`packages/ai/src/routing/types.ts` — **PREPARED, NOT IMPLEMENTED en production**.
`ModelCandidate`, `ModelQualityProfile` (alimenté par les mesures du benchmark, jamais
une note devinée), `RoutingDecision`, et une seule fonction pure
(`selectCheapestPassingCandidate`) — testée (5 tests), jamais appelée par
`apps/workers`. Aucune décision de routage automatique n'est prise en production par ce
lot. `EscalationReason` ne porte qu'une seule valeur (`"no_candidate_meets_threshold"`) —
la seule que `selectCheapestPassingCandidate()` produit réellement aujourd'hui ; un enum
plus large (bas niveau de confiance, candidats ambigus…) décrirait une vraie escalade
multi-étapes qui n'existe pas encore comme logique réelle, donc n'a pas été ajouté par
anticipation. Le champ `escalatedFrom` (toujours `null` en pratique) a été retiré pour la
même raison.

## 7. Frontière Scrapling (Phase 9)

**Ne scrape aucun site dans ce lot.** `packages/connectors/src/web/types.ts` propose
`WebMarketplaceFetcher` (une seule méthode `fetch()`, aucun parsing) comme frontière
technique entre un futur `RicardoConnector`/`AnibisConnector` (qui implémenteraient
`MarketplaceConnector`, déjà existant — `packages/connectors/src/types.ts`, ADR 0012,
inchangé) et un moteur de récupération web quelconque :

```
RicardoConnector implements MarketplaceConnector
  -> WebMarketplaceFetcher
      -> Scrapling (ou équivalent)

AnibisConnector implements MarketplaceConnector
  -> WebMarketplaceFetcher
      -> Scrapling

EbayConnector implements MarketplaceConnector
  -> API officielle (client.ts/oauth.ts) — jamais remplacée par Scrapling.
```

Aucune abstraction "marketplace fetching" générique n'existait avant ce lot
(`packages/connectors` n'avait qu'eBay, adossé à son API officielle) — `WebMarketplaceFetcher`
est la primitive minimale proposée, pas une architecture plus large. `NormalizedListing`
(sortie attendue d'un futur connecteur web) existe déjà et est réutilisé tel quel.

### Options d'intégration Scrapling (Python) dans un monorepo Node/TS

Ce dépôt est 100% Node/TypeScript. Scrapling est un paquet Python — l'installer
directement introduirait un second runtime. Options réelles, sans en implémenter
aucune dans ce lot :

| Option | Avantages | Inconvénients |
|---|---|---|
| **Service HTTP indépendant** (recommandé) | Isolation complète du runtime Python ; déployable seul sur Railway (même modèle que `apps/workers` déjà déployé séparément) ; `WebMarketplaceFetcher.fetch()` devient un simple appel HTTP interne, testable avec le mock fourni sans jamais lancer Python en local | Un service de plus à opérer/monitorer |
| Subprocess (spawn Python depuis Node) | Pas de service réseau séparé | Gestion de process fragile (zombies, timeouts, buffering stdout), couplage fort au runtime hôte, difficile à scaler indépendamment |
| Sidecar Python dans le même conteneur | Déploiement unique | Complexifie l'image Docker (deux runtimes), aucun des avantages d'isolation du service séparé |
| Pont/bibliothèque Node équivalente (sans Python) | Zéro second runtime | Pas de bibliothèque Node reconnue équivalente à Scrapling aujourd'hui — écarté pour l'instant |

**Recommandation** : service HTTP Python indépendant exposant un endpoint minimal
(`POST /fetch {url} -> {status, body}`), consommé depuis Node via
`WebMarketplaceFetcher.fetch()` — cohérent avec le déploiement déjà polyglotte de ce
projet (Railway héberge déjà `apps/workers` séparément de `apps/web` sur Vercel). Non
implémenté dans ce lot.

## 8. Frontière Agent Reach / signal de tendance (Phase 10)

**Aucune intégration réelle.** `packages/connectors/src/trend/types.ts` — `TrendSignal`,
`TrendSignalConnector`, un mock pour les tests. Règle absolue : ce signal n'assigne
jamais seul la valeur d'un produit — il ne peut qu'enrichir un signal de demande/
tendance/risque déjà calculé par Intelligence Core (`packages/core`), jamais
`marketValueEstimate`/`decision` directement. `TrendSignal` porte un discriminant fixe
`kind: "trend_signal"` qui le rend structurellement impossible à confondre avec
`NormalizedPriceObservation`/`ThirdPartyPriceHint` (preuve de marché, `../types.ts`,
ADR 0012) : aucun champ de prix dans ce type, et un futur code acceptant un union
"market evidence | trend signal" peut discriminer sur `kind` sans ambiguïté. Volontairement
hors du vocabulaire `ConnectorFamily` partagé (`packages/connectors/src/types.ts`) : une 6ᵉ
famille de connecteurs nécessiterait sa propre extension d'ADR 0012, non tranchée ici (même
règle que l'ADR 0013 a suivie pour la 5ᵉ famille, "Identification Connectors").

## 9. Universal Capture — confirmation explicite (Phase 2)

**IMPLEMENTED.** Le flux bêta (`apps/mobile/src/screens/UniversalCaptureBetaScreen.tsx`)
s'arrête désormais à un aperçu local après capture (crop, avertissements qualité, codes-
barres détectés) — aucun upload, aucune création de requête d'analyse, aucun appel IA
avant un tap explicite sur "Analyser". `TcgScanScreen` (flux historique) est inchangé.
121 tests mobiles au total (104 avant ce lot + 17 nouveaux), y compris la protection
anti double-tap et la couverture upload/analyse/polling jamais déclenchés avant
confirmation. L'écran garde une ref de montage (`mountedRef`) vérifiée avant toute mise
à jour d'état, pour ignorer un résultat qui reviendrait après un démontage (retour
arrière pendant l'envoi) — ceci ne rend PAS l'appel réseau sous-jacent annulable
(`tcgAdapter.analyze()` n'expose aucun mécanisme d'annulation aujourd'hui) ; l'appel déjà
en vol continue en arrière-plan jusqu'à son terme, limitation connue et non testée au
niveau composant (React Native n'a pas d'outillage de test de composants dans ce dépôt,
cohérent avec le reste du code mobile existant).

## 10. Résumé des statuts

| Élément | Statut |
|---|---|
| Universal Capture avec confirmation | IMPLEMENTED |
| Provider Groq | IMPLEMENTED (code), NOT LIVE-TESTED |
| Provider OpenRouter | IMPLEMENTED (code), NOT LIVE-TESTED |
| Config workers 4 providers | IMPLEMENTED, NOT LIVE-TESTED (Groq/OpenRouter) |
| Benchmark TCG multi-provider (mode simulé) | MOCK-TESTED |
| Benchmark TCG multi-provider (mode réel `--tcg-live`) | PREPARED, NOT LIVE-TESTED |
| Structure dataset TCG | PREPARED, aucune vraie photo |
| Routing IA (sélection coût/qualité) | PREPARED, NOT IMPLEMENTED en production |
| Frontière Scrapling / Web Marketplace Fetcher | PREPARED, NOT IMPLEMENTED, aucun scraping |
| Frontière Agent Reach / signal de tendance | PREPARED, NOT IMPLEMENTED, aucune intégration |
| Seuil `needsConfirmation` (source unique) | IMPLEMENTED — `isSufficientForAutoCorroboration()` (`packages/ai`), consommée par le worker réel et le benchmark |
| Outil dev "TCG Dataset Capture" (mobile) | IMPLEMENTED, MOCK-TESTED, **NOT DEVICE-TESTED** (voir `docs/tcg-dataset-samsung-test-procedure.md`, jamais encore exécutée sur un Samsung physique) |
| Validateur de dataset exporté (`--validate-tcg-dataset=`) | IMPLEMENTED, MOCK-TESTED (fichiers réels sur disque en test, aucun réseau) |
| Métriques TCG par tag + taux étendus (faux positif/négatif, ambiguïté, hybride) | IMPLEMENTED, MOCK-TESTED |
| Table de capacités provider (`findProviderCapabilities`) + garde vision benchmark | IMPLEMENTED, MOCK-TESTED — inerte en mode simulé, n'affecte que `--tcg-live` (jamais exécuté) |
| Garde-fous `--tcg-live` (`--confirm-live-cost` + `--tcg-max-examples`) | IMPLEMENTED, MOCK-TESTED — **NOT LIVE-TESTED**, jamais exécuté avec une vraie clé |

Tout le reste du pipeline TCG existant (`orchestratePokemonPipeline`, corroboration
catalogue, `collectorNumbersMatch`, pricing, persistance) est **inchangé** par ce lot.

## 11. Revue de consolidation

Une revue de consolidation a été menée avant proposition au merge (5 commits distincts
après les 9 commits d'origine, aucun de ces 9 commits réécrit/squashé) : centralisation
du seuil `needsConfirmation`, correction d'un bug de comparaison de numéro de collection
dans le benchmark (même classe de bug que Nymble 96/096, déjà résolue ailleurs via
`collectorNumbersMatch()`), extension de la détection de hallucination, réduction des
primitives de routing à ce qui est réellement produit, garde de démontage sur l'écran de
capture, discriminant structurel sur `TrendSignal`, et correction de deux références de
documentation mortes. Détail complet dans l'historique git
(`chore/lint-scripts-exclusion..HEAD`).

## 12. Long lot local — dataset capture (suite du lot)

Après la revue de consolidation ci-dessus, un second lot 100% local (COÛT = 0 CHF,
aucun push, aucun déploiement, aucun appel API réel) a ajouté :

- **Outil dev "TCG Dataset Capture"** (`apps/mobile/src/dataset-capture/` +
  `screens/TcgDatasetCaptureTool.tsx`) — capture de photos TCG réelles sans aucun réseau,
  stockage local (manifest JSON + images sous `FileSystem.documentDirectory`), export en
  ZIP réel (écrivain maison, zéro dépendance externe) déposé via Storage Access Framework
  (Android). Double garde `__DEV__` — jamais disponible en build release. Invariant "aucun
  réseau" prouvé mécaniquement par lecture de code source
  (`__tests__/no-network-invariant.test.ts`). Voir `docs/tcg-dataset-workflow.md` (usage)
  et `docs/tcg-dataset-samsung-test-procedure.md` (procédure device).
- **Format de vérité terrain unique** — `TcgGroundTruth`/`TcgDatasetTag`
  (`@dealradar/contracts/src/tcg-dataset.ts`) partagé entre l'outil mobile et
  `packages/benchmark` : aucun second format à faire correspondre.
- **Validateur de dataset exporté** (`--validate-tcg-dataset=`) — ids uniques, images
  existantes, extensions supportées, chemins sûrs, doublons probables (via
  `collectorNumbersMatch()`, jamais une égalité de texte brute), fichiers orphelins.
  Jamais de correction automatique.
- **Métriques TCG étendues** — segmentation par tag de difficulté (`byTag`), taux
  faux-positif/faux-négatif (autour du seuil réel `MIN_OVERALL_CONFIDENCE_FOR_AUTO_CORROBORATION`),
  taux d'ambiguïté, taux de succès "hybride" (identique au taux de succès tant qu'aucun
  extracteur déterministe n'existe — jamais fabriqué comme une vraie contribution
  hybride avant que ce soit réellement le cas).
- **Capacités provider** (`findProviderCapabilities`, `packages/ai`) — relevé que
  `llama-3.3-70b-versatile` (modèle Groq par défaut de la matrice benchmark) est TEXTE
  SEUL ; le benchmark TCG signale désormais `skipped_unsupported_capability` pour ce cas
  plutôt que de tenter un envoi d'image dont le comportement serait indéfini.
- **Garde-fous `--tcg-live`** — refuse tout run live sans `--confirm-live-cost` ET
  `--tcg-max-examples=<n>` explicites, avant même de charger le dataset. Jamais exécuté
  dans ce lot.

### Audit AI-LAST (Phase 20)

| | CURRENT | DESIRED (ADR 0013) | GAP |
|---|---|---|---|
| Déterministe d'abord | Aucun extracteur déterministe pour une photo de carte TCG (`deterministicSuccessRate` structurellement 0) | Un extracteur déterministe (OCR/code-barres) tenté avant tout appel IA | Non comblé — étape 1 de l'ADR 0013, hors périmètre de ce lot |
| Corroboration catalogue | `corroborate-catalog-identity.ts` appelé après extraction IA réussie, avant décision finale | Identique | Aucun |
| IA en dernier recours | Chaque scan TCG appelle l'IA directement (pas d'alternative déterministe existante) — donc l'IA n'est pas "en dernier recours" au sens strict, elle est la SEULE étape aujourd'hui | IA appelée seulement si le déterministe échoue/est ambigu | Attendu tant que l'étape déterministe n'existe pas — documenté honnêtement, jamais masqué |
| Modèle le moins cher qui passe un seuil | Aucun routage automatique — le provider est fixé par configuration (`AI_PROVIDER`), jamais choisi dynamiquement par coût/qualité | `selectCheapestPassingCandidate()` (`packages/ai/src/routing/`) appelé en production | Non comblé — primitives PREPARED uniquement (Phase 8, jamais branchées), délibéré |
| Confirmation utilisateur si incertain | `isSufficientForAutoCorroboration()` (seuil 0.7) décide `needsConfirmation` — un seul seuil, une seule fonction, consommée par le worker réel ET le benchmark | Identique | Aucun |
| Filet de repli explicite | `failedAnalysis()`/`insufficientDataAnalysis()` — jamais un statut ambigu retourné à l'appelant | Identique | Aucun |
| Télémétrie complète | `ExtractionTelemetry` (statut, provider, modèle, coût, latence, codes d'erreur) sur chaque appel IA réel | Identique | Aucun |

**Aucun endroit où l'IA est appelée "trop tôt"** n'a été trouvé — le seul écart réel
(absence d'étape déterministe) est une fonctionnalité non construite, pas une violation
de l'ordre AI-LAST : le pipeline actuel respecte l'ordre prévu pour les étapes qui
existent.

### Statuts DEVICE/LIVE/DEPLOYED (honnêtes, Phase 22)

- **DEVICE-TESTED** : rien dans ce lot (aucun accès à un Samsung physique pendant ce
  lot — voir `docs/tcg-dataset-samsung-test-procedure.md` pour la procédure à suivre).
- **LIVE-TESTED** : rien (Groq/OpenRouter restent NOT LIVE-TESTED depuis le lot
  précédent ; `--tcg-live` jamais exécuté).
- **DEPLOYED** : rien (aucun déploiement Railway/Vercel/Supabase déclenché).
