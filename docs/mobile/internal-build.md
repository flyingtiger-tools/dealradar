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
