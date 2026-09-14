# Build interne autonome — Dataset TCG sans Metro

Doc opérationnelle (LOT "Samsung autonome + caméra + dataset", 2026-09-14).
Permet de générer un APK Android **local, 0 CHF, sans EAS cloud, sans
dépendance Metro**, avec l'outil "Dataset TCG" accessible — pour continuer à
collecter des photos en vacances sans PC ensuite.

## Principe

- `__DEV__` vaut **toujours `false`** dans un build de type `release`
  (y compris ce build interne, qui EST un build `release` — voir plus bas).
  Un flag séparé est donc nécessaire pour exposer Dataset TCG hors
  Development Build : `EXPO_PUBLIC_INTERNAL_TOOLS=true`, lu par
  [`apps/mobile/src/config/internal-tools.ts`](../../apps/mobile/src/config/internal-tools.ts)
  (`INTERNAL_TOOLS_ENABLED = __DEV__ || EXPO_PUBLIC_INTERNAL_TOOLS === "true"`).
- Ce flag **n'est jamais défini par défaut** — aucun fichier `.env*` commité
  ne le positionne, `apps/mobile/.env.local` (gitignoré, voir
  [local-dev-setup.md](local-dev-setup.md)) ne le contient pas non plus. Il
  doit être exporté explicitement dans le shell qui lance CE build précis.
  Un futur vrai build public (`NODE_ENV=production`, sans ce flag exporté)
  n'active donc **jamais** Dataset TCG par accident.
- [`app.config.ts`](../../apps/mobile/app.config.ts) lit ce même flag pour
  basculer `name`/`android.package`/`ios.bundleIdentifier` :
  - Flag absent (défaut, build grand public normal) → `"DealRadar"` /
    `com.dealradar.mobile` — **strictement identique à aujourd'hui**.
  - Flag présent → `"DealRadar Internal"` / `com.dealradar.mobile.internal`
    — package id **distinct**, donc cette app cohabite sur le même
    appareil avec le build standard `com.dealradar.mobile` sans aucun
    conflit d'installation ni de signature (deux package id différents =
    deux apps Android complètement indépendantes du point de vue du
    système, quelle que soit la clé utilisée pour signer chacune).
- Le build `release` généré par `expo prebuild` réutilise par défaut la
  **clé de signature debug** (`signingConfigs.debug` réemployé dans
  `buildTypes.release`, voir `android/app/build.gradle` généré) — donc
  aucune création de keystore, aucun compte/service payant nécessaire :
  0 CHF, 100% local.
- Un build `release` embarque le bundle JS dans l'APK (pas de serveur
  Metro requis au runtime) — c'est précisément ce qui permet de fermer
  Metro et de garder l'app fonctionnelle avec zéro PC ensuite.

## Générer le build interne

Depuis `apps/mobile/`, dans un terminal où **seule cette invocation** a le
flag :

```bash
cd apps/mobile
EXPO_PUBLIC_INTERNAL_TOOLS=true npx expo prebuild --clean --platform android
```

`prebuild --clean` régénère entièrement `android/` avec le nouveau
`applicationId` (`com.dealradar.mobile.internal`) et le nouveau nom
d'app — nécessaire car ces valeurs sont figées dans les fichiers Gradle/XML
générés, pas relues dynamiquement au runtime.

Puis compiler la variante `release` (toujours avec le flag, pour que la
valeur soit inlinée dans le bundle JS embarqué) :

```bash
EXPO_PUBLIC_INTERNAL_TOOLS=true npx expo run:android --variant release
```

(Si `expo run:android` échoue à auto-installer l'APK à cause d'un souci
`adb` — voir [local-dev-setup.md](local-dev-setup.md) — le Gradle build
aboutit quand même : APK récupérable sous
`android/app/build/outputs/apk/release/app-release.apk`, à installer
manuellement avec `adb install -r <chemin>`.)

## Installer et vérifier (Metro coupé)

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Puis, pour prouver que ça fonctionne **sans Metro** :

1. Arrêter Metro complètement (fermer le process `expo start` / le
   terminal qui l'exécute).
2. `adb shell am force-stop com.dealradar.mobile` (build standard, s'il
   tournait) et `adb shell am force-stop com.dealradar.mobile.internal`.
3. Relancer uniquement le build interne :
   ```bash
   adb shell am start -n com.dealradar.mobile.internal/.MainActivity
   ```
4. Vérifier via `adb shell dumpsys window | Select-String "mCurrentFocus"`
   (ou capture d'écran / `uiautomator dump`) que l'app démarre sans écran
   d'erreur `DevLauncherErrorActivity`, que le bouton "Dataset TCG (dev)"
   est présent, et que la caméra fonctionne (voir le correctif
   `onMountError` dans
   [`UniversalCaptureScreen.tsx`](../../apps/mobile/src/capture/UniversalCaptureScreen.tsx)).

## Problèmes de build réels rencontrés et corrigés (2026-09-14)

Deux bugs distincts, propres à `expo run:android --variant release` dans
**ce monorepo pnpm sous Windows** (jamais rencontrés avec `expo start` ni
avec le build `debug` précédent) — aucun lien avec le code de l'app :

1. **`--entry-file` relatif mal résolu par `expo export:embed`.** Le
   plugin Gradle React Native convertit l'`--entry-file` absolu (calculé
   correctement) en chemin relatif avant de lancer la commande — mais
   `expo export:embed`, une fois invoqué avec ce chemin relatif, le résout
   à tort contre la racine du **workspace pnpm** au lieu de `apps/mobile`
   (`metro.config.js` ajoute la racine du workspace à `watchFolders` pour
   la résolution des dépendances hoistées — c'est probablement ce qui
   déclenche la mauvaise détection de racine côté `expo export:embed`).
   Erreur observée : `Unable to resolve module ./index.ts from
   <racine du repo>/.`. Reproduit et confirmé **hors Gradle** (même
   commande, mêmes symptômes). **Corrigé** par
   [`apps/mobile/scripts/gradle-bundle-embed-entry-fix.js`](../../apps/mobile/scripts/gradle-bundle-embed-entry-fix.js)
   (committé, survit à `expo prebuild`) : un wrapper qui réabsolutise
   `--entry-file` puis délègue intégralement au vrai `@expo/cli`, référencé
   via la propriété `cliFile` du bloc `react {}` dans
   `android/app/build.gradle` (généré, gitignoré — **cette référence doit
   être réappliquée après chaque `expo prebuild --clean`**, voir le diff
   dans le commit qui introduit ce fichier).
2. **Limite Windows `MAX_PATH` (260 caractères) sur la compilation C++
   native (`expo-modules-core`, CMake/ninja).** Le nom de dossier encodé
   par pnpm pour `react-native` dans `node_modules/.pnpm/` (toutes les
   peer-dependencies résolues dans le nom du dossier) rend certains chemins
   d'en-têtes C++ (ex. `ReactCommon/CallInvokerHolder.h`) trop longs pour
   l'API Windows classique — `ninja: error: ... Filename longer than 260
   characters`. Sans lien avec le code du projet (uniquement la profondeur
   du chemin d'installation). **Contourné** en mappant temporairement le
   dossier racine du repo sur un lecteur virtuel via `subst` (raccourcit
   tous les chemins résolus, pnpm utilisant des symlinks relatifs) :
   ```bash
   subst Z: "C:\chemin\vers\dealradar"
   cd /z/apps/mobile/android
   ./gradlew.bat app:assembleRelease -x lint -x test -PreactNativeArchitectures=arm64-v8a
   ```
   `subst` ne nécessite **aucun droit administrateur**, ne modifie **rien**
   dans le repo, et se retire proprement avec `subst Z: /D` une fois le
   build terminé — à refaire à chaque nouvelle session de build sur cette
   machine si le problème réapparaît (il n'est pas persistant).
   `-PreactNativeArchitectures=arm64-v8a` restreint aussi le build au seul
   ABI du Samsung S24 Ultra (64 bits), accessoirement plus rapide.

## Garanties de sécurité

- Le flag `EXPO_PUBLIC_INTERNAL_TOOLS` n'est stocké dans **aucun** fichier
  committé — ni `.env.local` (gitignoré, valeurs différentes de toute
  façon), ni `eas.json`, ni `app.config.ts` (qui ne fait que *lire* la
  variable, jamais la définir).
- `TcgDatasetCaptureTool.tsx` a une garde défensive indépendante
  (`if (!INTERNAL_TOOLS_ENABLED) return null;`) en plus du filtrage déjà
  fait par `App.tsx` avant même d'ajouter l'onglet à la barre — double
  garde, donc même un chemin de navigation inattendu ne peut pas exposer
  l'outil hors de ce flag.
- Le build interne n'a **aucun bouton d'analyse/upload** dans l'écran
  Dataset TCG (capture + sauvegarde locale + export ZIP uniquement,
  aucun réseau) — voir le commentaire de fichier de
  `TcgDatasetCaptureTool.tsx`.
