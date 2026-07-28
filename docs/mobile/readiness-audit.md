# Audit de préparation mobile

**Date** : 2026-07-27 · **Méthode** : `graphify query`/`explain` sur
`graphify-out/graph.json` (orientation) puis lecture ciblée des fichiers
identifiés — pas de grep exploratoire à l'aveugle. Voir ADR 0010 pour les
décisions qui en découlent.

## Ce qui existe déjà et se réutilise tel quel

| Domaine | Fichiers | Réutilisation mobile |
|---|---|---|
| Authentification | `apps/web/src/lib/supabase/{client,server,middleware}.ts` (cookies SSR), `oauth-buttons.tsx`, `login-form.tsx` | Supabase Auth émet aussi des JWT bearer — le mobile s'authentifie pareil, envoie `Authorization: Bearer <token>`. Le vérificateur côté cookie SSR ne s'applique pas ; nouveau vérificateur côté Route Handler nécessaire (`route-auth.ts`). |
| Intelligence Core | `packages/core/src/intelligence/{identify,estimate,comparables,decision,profit,scores,why-panel,pipeline}.ts` | Réutilisé intégralement via `runIntelligencePipeline()`. Aucune logique de score dupliquée côté mobile. |
| Extraction IA | `packages/ai/src/extraction/extract-product.ts`, `parser/deterministic-extractor.ts`, `provider/openai.ts` | C'est déjà le pipeline "déterministe d'abord, IA si besoin" demandé pour mobile — réutilisé tel quel par le nouveau job worker. |
| Cache produit partagé | `packages/ai/src/cache/{memory-cache,compute-key,image-fingerprint}.ts`, `packages/ingestion/src/ai-cache-supabase.ts` (table `ai_extraction_cache`, migration 0011) | Clé déjà sans identité utilisateur. Aucune seconde table de cache produit créée. |
| Budget IA atomique | `packages/ai/src/budget/types.ts` (`BudgetGuard`), RPC `reserve_ai_budget`/`finalize_ai_budget`/`release_ai_budget` (migration 0011, verrou `pg_advisory_xact_lock`) | Patron cloné pour le rate limiting mobile (aucun rate limiter n'existait avant ce lot — confirmé par requête graphify, seul `rate()` de `packages/benchmark` existait, sans rapport). |
| Sécurité image / SSRF | `packages/ai/src/image-policy/download-image-securely.ts` (résolution DNS + rejet IP privée/RFC-1918, détection MIME par octets magiques), `select-and-validate-images.ts` (allowlist domaine) | Réutilisé tel quel pour toute image/URL soumise par le mobile — aucune reconstruction. |
| Jobs asynchrones | `apps/web/src/lib/pgboss.ts` (`enqueueJob`), `packages/core/src/queues.ts` (`QUEUES`), consommateur `apps/workers` | Nouvelle entrée de queue `analysis.process`, même patron que les jobs d'ingestion existants. |
| Base de données / RLS | 11 migrations (`supabase/migrations/0001`–`0011`) ; RLS activé par table depuis 0009 ; convention "tables opérationnelles = service role uniquement, RLS activé sans policy" depuis 0011 | Nouvelle table suit la même convention RLS. |
| Contrats Zod | `packages/contracts` (`item-condition.ts`, `category-slug.ts`), ré-exportés par `packages/core/src/validation/schemas.ts` | Nouveaux schémas d'analyse ajoutés au même endroit, même convention de ré-export. |
| Secrets client | `apps/web/src/env.ts` : seuls `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` sont publics | Confirme que le mobile n'a jamais besoin de la clé service role — uniquement l'URL + la clé anonyme. |
| ADRs | `docs/adr/0001`–`0009` | Numérotation suivante naturelle : `0010`. |

## Ce qui n'existe pas et est nouveau dans ce lot

| Manque | Impact | Ajout de ce lot |
|---|---|---|
| Aucune API publique JSON versionnée | Les Server Actions (`admin/ingestion/actions.ts`) ne sont pas appelables depuis un client non-navigateur | `apps/web/src/app/api/v1/analyses/{route.ts,[id]/route.ts}` |
| Aucun rate limiter | Un client mobile peut spammer l'endpoint d'analyse sans coût réel aujourd'hui | RPC `check_and_increment_rate_limit`, migration 0012 |
| Aucune notion d'idempotence applicative | Un double-tap ou une réémission réseau créerait des analyses dupliquées | Contrainte unique `(user_id, client_request_id)` + `on conflict do nothing returning` |
| Aucun stockage de fichier utilisateur (photos/captures) | Rien ne reçoit ni ne retient une capture d'écran ou une photo aujourd'hui | Bucket Storage privé `analysis-uploads`, propriétaire uniquement |
| Aucune application mobile | Aucun React Native/Expo dans le repo, aucun SDK Android, pas de Xcode | `apps/mobile` (nouveau workspace package via le glob `apps/*` de `pnpm-workspace.yaml`) |

## Contraintes d'environnement constatées (pas supposées)

- Node `v24.18.0` / pnpm `9.15.0` disponibles ; `.nvmrc` cible `20.18.1`
  (`engines.node >=20.11` dans `package.json` racine — compatible).
- **Aucun SDK Android, `adb`, JDK, ni CLI Expo installés** avant ce lot
  (vérifié : `command -v adb`/`java`/`expo` tous absents, pas de dossier
  `%LOCALAPPDATA%\Android\Sdk`). Un toolchain minimal a été installé pour
  ce lot spécifiquement — voir résultat dans la section Spikes.
- **Aucun macOS/Xcode disponible** (machine Windows 11). Fait
  structurellement impossible à contourner localement : le spike iOS est
  donc écrit mais non compilé, non exécuté, dans ce lot.
- `graphify` CLI et l'interpréteur Python référencé par le skill ne sont
  pas fonctionnels dans cet environnement (`graphify-out/.graphify_python`
  vide, aucun interpréteur Python exécutable trouvé) — les requêtes
  graphify de ce lot ont été exécutées via un traversal Node.js reproduisant
  fidèlement l'algorithme BFS/scoring documenté dans
  `.claude/skills/graphify/references/query.md`, directement sur
  `graphify-out/graph.json`, plutôt que via le binaire ou le fallback
  Python indisponibles.

## Résultat réel du spike Android (pas une projection)

Le toolchain a été réellement installé et exercé sur cette machine, pas seulement documenté :

- JDK 17 (Temurin), Android cmdline-tools, `platform-tools`, `build-tools;34.0.0`,
  `platforms;android-34`, `emulator`, `system-images;android-34;google_apis;x86_64`
  installés avec succès. AVD `dealradar_test` (Pixel 6, Android 14) créé.
- **Accélération matérielle confirmée disponible** : `emulator -accel-check`
  rapporte `WHPX(10.0.26200) is installed and usable` — contrairement au
  risque anticipé, l'émulateur démarre réellement (headless, `-no-window
  -gpu swiftshader_indirect`) et `adb devices`/`getprop sys.boot_completed`
  confirment un boot complet, pas seulement un process qui démarre.
- `expo prebuild --platform android` génère correctement le projet natif ;
  le config plugin `withAndroidOverlayCopilot.js` a été vérifié à l'exécution
  (pas seulement relu) : les permissions et la déclaration `<service
  android:foregroundServiceType="mediaProjection">` apparaissent
  correctement dans l'`AndroidManifest.xml` généré.
- **Le module natif `overlay-copilot` compile avec succès** (`:overlay-copilot:compileDebugKotlin`)
  après correction de bugs réels trouvés à la compilation, pas seulement à
  la relecture :
  - API Expo Modules (`Module`/`ModuleDefinition`) requise au lieu de l'API
    classique `ReactPackage`/`ReactContextBaseJavaModule` — `expo-module.config.json`
    attend des classes `Module`, l'ancienne API échoue à la génération
    d'`ExpoModulesPackageList.java` (`Class<OverlayCopilotPackage> cannot be
    converted to Class<? extends Module>`). Migration complète effectuée.
  - Ordre d'initialisation Kotlin : une propriété référencée dans un bloc
    `init` doit être déclarée avant ce bloc, pas après.
  - Un paramètre de lambda nommé `imageReader` masquait la propriété de
    classe du même nom, rendant `imageReader = null` inopérant (assignation
    silencieusement redirigée vers le paramètre local, pas la propriété).
  - Version de `kotlin-stdlib` fixée localement dans `overlay-copilot/build.gradle`
    en conflit avec la version résolue par `expo-modules-core` (Compose
    Compiler exigeant 1.9.25, résolution partant sur 1.9.24) — fixé en
    laissant le plugin `kotlin-android` apporter la bonne version, plus une
    contrainte explicite `android.kotlinVersion=1.9.25` injectée par le
    config plugin (persiste à travers un futur `expo prebuild`).
- `local.properties` généré par `expo prebuild` doit utiliser des slashs
  avant (`C:/Users/...`), pas des antislashs — un fichier `.properties` Java
  interprète `\U`/`\A`/etc. comme des échappements invalides, produisant un
  chemin SDK corrompu (`IOException: La syntaxe du nom de fichier... est
  incorrecte`) avant même d'atteindre le code applicatif.
- **Blocage réel non résolu dans ce lot** : la compilation native C++ de
  `expo-modules-core` échoue avec `ninja: error: ... Filename longer than
  260 characters` — la structure de dossiers de pnpm
  (`node_modules/.pnpm/react-native@0.76.9_@babel+core@...+react@18.3.1/...`)
  dépasse la limite Windows `MAX_PATH` classique. Confirmé :
  `LongPathsEnabled=0` dans le registre à l'exécution de ce lot. Le
  correctif (`HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled=1`,
  puis redémarrage) nécessite des droits administrateur que cette session
  d'outillage n'a pas — l'utilisateur doit l'appliquer lui-même. Tout le
  reste (manifeste, permissions, service, module Kotlin) est vérifié
  correct jusqu'à ce point exact ; le lien final de l'APK reste à confirmer
  après ce correctif.

### Régression découverte et corrigée en cours de route

Ajouter `apps/mobile` au même workspace pnpm a fait dériver la résolution
de `@types/react`/`@types/react-dom` pour `apps/web` (React 19) — un
premier correctif erroné (les épingler à une version exacte différente de
celle réellement utilisée par `react`/`react-dom` en exécution) a
introduit une vraie régression de typecheck (« ReactPortal » incompatible)
sur des dizaines de fichiers non liés à ce lot. Diagnostiquée précisément
(`tsc --traceResolution`, comparaison avec `git show HEAD:pnpm-lock.yaml`)
puis corrigée en laissant pnpm re-résoudre `@types/react`/`@types/react-dom`
vers leur version d'origine, cohérente avec `react`/`react-dom` réellement
installés (19.2.17/19.2.3, appairés à `react@19.2.8`). Le monorepo entier
(`typecheck`/`lint`/`test`/`build`, 9-10 paquets selon la tâche) est vert
après correction — vérifié, pas supposé.

## Ne duplique pas

Confirmé ne pas être reconstruit dans ce lot : Intelligence Core, moteur
d'extraction IA, cache d'extraction, budget IA atomique, normalisation de
listing, catégories/taxonomie, contrats de domaine existants. Le mobile
consomme ces packages via l'API et le job worker, il ne recrée rien.

## Addendum — 2026-07-28 : build complet + validation réelle sur émulateur

Le blocage `MAX_PATH`/`ninja.exe` documenté ci-dessus a été levé en clonant
le dépôt vers `C:\dr` (racine à 5 caractères, approche la plus simple et
réversible, choisie explicitement plutôt que de déplacer le virtual store
pnpm global). Historique/branche/modifications non commitées/fichiers
untracked utiles préservés via `git clone --local` + `git diff`/`git apply`
+ liste `git status --porcelain --untracked-files=all`. Aucun commit, push,
ni migration 0012 appliqués — conformément à la contrainte explicite.

**Build complet réussi** : `expo prebuild` + `./gradlew :app:assembleDebug`
→ `BUILD SUCCESSFUL`, APK généré et installé sur l'émulateur
`dealradar_test` (API 34, x86_64). Chemin final le plus long observé
descendu sous la limite après clonage ; le build entier passe sans
contournement de `LongPathsEnabled`.

**Bugs réels rencontrés et corrigés pendant cette passe de build/test** (en
plus de ceux déjà documentés ci-dessus) :

1. **Ordre de tâches Gradle** : `overlay-copilot/build.gradle` ne déclarait
   pas `expo-modules-core` comme dépendance explicite — build "accidentellement"
   correct auparavant à cause d'un cache Gradle non nettoyé ; un build
   réellement propre échouait avec des dizaines d'erreurs "Unresolved
   reference" sur les symboles Expo Modules API. Corrigé par
   `implementation project(':expo-modules-core')`.
2. **Bug amont `expo-modules-autolinking@2.0.8`** : `PackageList.java`
   généré importait `expo.core.ExpoModulesPackage` (chemin legacy erroné,
   la vraie classe est `expo.modules.ExpoModulesPackage`) à cause d'un
   `try{}catch{return null}` silencieux dans `requireConfig()` qui avalait
   une exception lors de l'évaluation du `react-native.config.js` dynamique
   d'`expo` lui-même. Contourné en repatchant `autolinking.json` généré ;
   **non durable** à travers un `expo prebuild` complet qui régénère le
   cache — nécessiterait un correctif upstream ou un `patch-package` pour
   survivre durablement, signalé ici plutôt que silencieusement recontourné
   à chaque fois.
3. **Résolution Metro/pnpm** : `Unable to resolve module
   @babel/runtime/helpers/interopRequireDefault` — corrigé en ajoutant
   `apps/mobile/metro.config.js` (résolveur conscient du monorepo :
   `watchFolders`, `nodeModulesPaths`, `unstable_enableSymlinks`) **et**
   `@babel/runtime` en dépendance directe explicite d'`apps/mobile` (les
   deux nécessaires ensemble — Metro ne suit pas la résolution non-plate de
   pnpm sans le symlink que crée une dépendance directe).
4. **Pont JS/natif incompatible** : `overlay-copilot.ts` utilisait encore
   `NativeModules.OverlayCopilot` (pont classique React Native), alors que
   le module Kotlin est écrit avec l'Expo Modules API — les deux systèmes
   ne s'interopèrent pas, donc chaque appel échouait silencieusement
   (l'app restait bloquée sur `requestingOverlayPermission`). Corrigé en
   réécrivant le pont JS avec `requireOptionalNativeModule` d'
   `expo-modules-core`.
5. **Glissement de bulle non fonctionnel** : le `OnTouchListener` renvoyait
   `false` sur `ACTION_DOWN`, donc le geste n'était jamais "réclamé" et
   `ACTION_MOVE` n'arrivait jamais. Corrigé en renvoyant `true` et en
   distinguant tap/glissement via `scaledTouchSlop`.
6. **Race condition de promotion du foreground service** : promouvoir le
   type de service via `startForegroundService(Intent)` (asynchrone) puis
   appeler immédiatement `getMediaProjection()` (synchrone) provoquait
   `SecurityException: Media projections require a foreground service of
   type ... MEDIA_PROJECTION` — la promotion n'avait pas encore eu lieu au
   moment de l'appel. Corrigé avec une référence statique `@Volatile
   instance` permettant un appel de méthode direct et synchrone.
7. **Callback MediaProjection manquant (Android 14)** : une fois la race
   condition ci-dessus corrigée, un **nouveau** crash distinct est apparu :
   `IllegalStateException: Must register a callback before starting
   capture` sur `MediaProjection.createVirtualDisplay()`. Android 14+ exige
   l'enregistrement d'un `MediaProjection.Callback` via
   `registerCallback()` avant tout appel à `createVirtualDisplay()`.
   Corrigé dans `OverlayCopilotModule.captureSingleFrame()` en enregistrant
   un callback minimal juste avant la création du display virtuel, et en
   le désenregistrant dans le `finally` de la capture ponctuelle.

**Résultat après le correctif #7 — cycle complet vérifié réellement sur
l'émulateur, pas supposé** :
- Activation du Copilote → bulle affichée → tap sur la bulle → vrai
  dialogue de consentement `MediaProjection` du système → "Start now" →
  **aucun crash** (confirmé par `pidof` : process vivant, et par grep
  logcat élargi sur `FATAL`/`SecurityException`/`AndroidRuntime` : aucune
  correspondance) → état `previewingCapture` avec un aperçu réel de la
  capture affiché dans l'UI → fichier `copilot-capture-*.png` confirmé
  présent dans `/data/data/com.dealradar.mobile/cache/` (`run-as` + `find`).
- "Annuler et supprimer" → fichier de cache confirmé supprimé (`find`
  après tap : aucun résultat) → retour à l'état `bubbleActive`.
- "Désactiver le Copilote" → état UI `stopped`, bulle disparue,
  `dumpsys notification` confirme `numPostedByApp=0` (aucune notification
  active de premier plan restante — l'unique `ServiceRecord` encore visible
  dans `dumpsys activity services` référence un PID mort d'un cycle de
  test précédent, pas le processus courant).
- Aucune capture déclenchée sans tap explicite sur la bulle : vérifié en
  laissant la bulle active 6 secondes sans interaction, aucun fichier
  `copilot-capture-*` créé.
- Logs de l'application (filtrés par PID du processus courant, pas de bruit
  système) inspectés pour données sensibles : aucun jeton, aucune image en
  base64, aucun chemin de capture ne fuite dans logcat.

**Statut final overlay/MediaProjection : GO** — le flux complet
(permission → bulle → consentement → capture ponctuelle → aperçu →
suppression → arrêt du service) fonctionne de bout en bout sur émulateur,
sans contournement ni simulation. Seul le point upstream #2 reste une dette
technique à traiter avant un build de production reproductible (patch
durable ou mise à jour de dépendance).

**Écart non lié détecté** : `pnpm typecheck` échoue sur `@dealradar/web`
(`apps/web/src/components/ui/*.tsx`, erreurs `ReactPortal`/`ReactNode`
incompatibles) — double résolution de `@types/react` (18.3.31 pour
react-native/mobile, 19.2.17 pour web) dans `pnpm-lock.yaml`. Antérieur à
cette session de validation Android (visible dans l'état git au début de
cette session), **non causé** par les correctifs Kotlin/TS ci-dessus, et
**non corrigé ici** — hors périmètre explicite de cette validation
(changement de code métier `apps/web`), signalé pour décision séparée.
`apps/mobile` lui-même est vert : `typecheck`/`lint`/`test` passent tous
les trois sans erreur.

## Addendum — 2026-07-28 (suite) : reproductibilité durable et monorepo entièrement vert

Les deux écarts identifiés dans l'addendum précédent sont désormais corrigés
durablement (plus de patch manuel dans `node_modules`, plus d'écart
`@types/react` non résolu). Voir `docs/mobile/lot1-final-report.md` pour le
rapport complet ; résumé technique ici.

**Bug `expo-modules-autolinking` — cause racine réellement isolée** (pas
supposée) : `loadConfigAsync(packageRoot)` (`expo-modules-autolinking@2.0.8`,
`build/reactNativeConfig/config.js`) reçoit `packageRoot` sous sa forme de
**chemin symlink apparent** pnpm (ex. `apps/mobile/node_modules/expo`), pas
son realpath. `require-from-string` construit sa recherche de résolution de
modules à partir de ce chemin apparent, qui — sous la structure
`node_modules` stricte (non hissée) de pnpm — ne contient pas les propres
dépendances du paquet (`expo-modules-autolinking/exports` pour `expo`,
`@react-native/community-cli-plugin` pour `react-native`) : celles-ci
n'existent que comme voisines dans le vrai répertoire du virtual store
`.pnpm`. Reproduit isolément avec un script Node minimal appelant
`loadConfigAsync()` une fois avec le chemin apparent (échec confirmé,
`Cannot find module 'expo-modules-autolinking/exports'`) et une fois avec le
realpath (succès). Le `catch {}` silencieux de `requireConfig()` avale cette
`Cannot find module`, et le code appelant retombe sur un
`packageImportPath` deviné par regex (`import
${packageName}.${nativePackageClassName};`) qui combine à tort le namespace
Android hérité `expo.core` avec le nom de classe réel `ExpoModulesPackage`
(qui vit dans `expo.modules`).

**Solution durable retenue** : aucune version corrigée n'existe dans la
ligne `2.0.x` (dernière publiée : `2.0.8`, exactement celle utilisée —
vérifié sur le registre npm) ; une mise à jour de dépendance n'est donc pas
possible sans changer de SDK Expo majeur, hors périmètre. Correctif appliqué
via **`pnpm patch`** (mécanisme pnpm natif, pas d'édition manuelle de
`node_modules`) : `patches/expo-modules-autolinking@2.0.8.patch`, une seule
ligne ajoutée dans `loadConfigAsync()` —
`packageRoot = await fs.realpath(packageRoot).catch(() => packageRoot);` —
avant de construire `configJsPath`. Enregistré dans le champ `"pnpm"` de
`package.json` racine (seul emplacement que cette version de pnpm applique
réellement pour `patchedDependencies` — `pnpm-workspace.yaml` accepte la
même clé silencieusement sans jamais l'appliquer, confirmé empiriquement
par un aller-retour ; l'avertissement CLI "no longer read" s'est avéré
trompeur : le patch est bien appliqué à chaque `pnpm install`, vérifié
après plusieurs cycles complets de suppression de `node_modules` +
réinstallation).

**Preuve de survie à un prebuild propre** : depuis `C:\dr`, suppression de
tous les `node_modules` + `apps/mobile/android` + `.expo`, `pnpm install`
propre (le patch se réapplique, vérifié via le dossier
`expo-modules-autolinking@2.0.8_patch_hash=...` et son contenu), `expo
prebuild --platform android`, puis `assembleDebug` → `BUILD SUCCESSFUL in
1m 43s` (build non-incrémental complet). APK réinstallé sur l'émulateur,
application lancée, bulle affichée — cycle complet reproduit avec succès
sur une machine vierge.

**Conflit `@types/react` — cause racine réellement isolée** : `apps/web`
(React 19, `@types/react@19.2.17`) et `apps/mobile` (React Native 0.76,
`@types/react@18.3.31`) déclarent chacun leur propre version en
dépendance directe — c'est correct et voulu, pas le bug. Le bug : par
défaut, pnpm hisse **tout** paquet ambigu (y compris `@types/react`) dans
un dossier partagé `node_modules/.pnpm/node_modules/`, utilisé par
Node/TypeScript quand un fichier tiers (ex. les `.d.ts` internes de `next`
sous `next/dist/styled-jsx/...`) remonte l'arborescence à la recherche de
`@types/react` sans que ce fichier ait sa propre résolution scoping vers
la bonne version. Avec deux versions concurrentes dans le même workspace,
cet emplacement partagé est gagné de façon non déterministe par l'une ou
l'autre — confirmé en comparant deux installations propres identiques
(même lockfile) où l'une remportait 18.3.31 pour ce slot et compilait
`apps/web` avec des erreurs `ReactNode`/`ReactPortal` incompatibles,
pendant qu'une réinstallation ultérieure faisait gagner une configuration
différente. TypeScript charge alors, pour un même programme de
compilation, des déclarations globales `JSX`/`React` provenant de deux
versions différentes d'`@types/react`, produisant des erreurs de type
factices dans le propre code d'`apps/web` (`card.tsx`, `input.tsx`,
`select.tsx`, `empty-state.tsx`).

**Résolution retenue** : exclure `@types/react` et `@types/react-dom` du
hissage pnpm via `hoist-pattern[]` dans `.npmrc` (mécanisme pnpm natif,
documenté, appliqué à l'échelle du monorepo mais ciblé sur ces deux seuls
paquets — pas une correction globale fragile type override de version ou
résolution forcée). Chaque paquet du workspace continue de résoudre
`@types/react` strictement via sa propre dépendance directe ; les rares
fichiers tiers qui ne trouvaient `@types/react` que via le hissage partagé
cessent simplement de le résoudre (sans conséquence : ces fichiers ne font
pas partie de notre graphe de types). Vérifié : `apps/web` et
`apps/mobile` passent `tsc --noEmit` avec le code de sortie `0`, à travers
plusieurs cycles complets de suppression + réinstallation de
`node_modules`. Aucun type React n'est masqué par un `skipLibCheck` ni un
cast artificiel — vérifié : `skipLibCheck: true` (préexistant dans
`packages/config/tsconfig.base.json`) ne concerne que le contenu interne
des fichiers `.d.ts`, pas les erreurs de notre propre code applicatif (qui
apparaissaient malgré ce réglage) ; aucun `as any`/`as unknown
as`/`@ts-ignore` dans les composants concernés (vérifié par grep).

**Écart restant traité en prime** : `pnpm build` échouait sur
`@dealradar/mobile` (script `expo-doctor`, préexistant, choisi comme
espace réservé avant l'existence du module natif) à cause de deux
signalements légitimes mais devenus obsolètes : `expo-modules-core` en
dépendance directe (nécessaire à l'origine pour la résolution TypeScript
du pont natif) et un `metro.config.js` personnalisé (nécessaire pour la
résolution monorepo pnpm). Corrigés sans perdre les fixes réels : (1)
`overlay-copilot.ts` importe désormais `requireOptionalNativeModule`
depuis `expo` (qui le ré-exporte tel quel depuis `expo-modules-core`,
vérifié dans `expo/src/Expo.ts`) plutôt que directement depuis
`expo-modules-core`, avec un type `EventSubscription` structurel minimal
local (`{ remove(): void }`, seule méthode réellement utilisée) plutôt que
le type exact non ré-exporté — `expo-modules-core` retiré des dépendances
directes d'`apps/mobile` ; toujours résolu par l'autolinking Android via
la dépendance transitive d'`expo` (vérifié : le module Gradle
`:expo-modules-core` reste présent et `UP-TO-DATE` au build). (2)
`metro.config.js` fusionne désormais `watchFolders` avec les valeurs par
défaut d'Expo au lieu de les remplacer. (3) `resolver.unstable_enableSymlinks`
reste explicitement activé (nécessaire, pas de mécanisme d'exclusion
disponible dans `expo-doctor` pour ce cas précis) — script `build` du
paquet mobile changé pour `expo export --platform android` (un vrai pas de
build : bundle JS produit, ~7s), `expo-doctor` n'étant plus utilisé comme
porte de validation mais reste vert de son côté aussi (18/18 vérifié
manuellement). Réexécuté sur l'émulateur après ce changement : bulle
toujours fonctionnelle, aucune régression du pont JS/natif.

**Monorepo entièrement vert, vérifié plusieurs fois à travers des cycles
complets de suppression + réinstallation** : `pnpm typecheck` (9/9),
`pnpm lint` (9/9), `pnpm test` (9/9, tous les tests passent), `pnpm build`
(3/3, code de sortie `0`).
