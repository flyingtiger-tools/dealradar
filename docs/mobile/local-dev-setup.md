# Lancer l'app mobile en local — bootstrap sans piège

Doc opérationnelle (trouvé/corrigé lors du diagnostic device réel du
2026-09-14, Samsung S24 Ultra). Trois bugs distincts empêchaient un simple
`expo start` de fonctionner sur un environnement fraîchement installé — ce
document existe pour qu'un futur `expo start` n'y retombe pas.

## Prérequis (une fois)

- Android Studio + SDK + `adb` installés (voir la section "SDK" plus bas si
  jamais absents — winget/sdkmanager, 0 CHF).
- `apps/mobile/.env.local` présent (voir ci-dessous) — **gitignoré**, à
  recréer sur chaque nouvelle machine.

## `apps/mobile/.env.local` — pourquoi il est nécessaire

Expo CLI charge automatiquement les fichiers `.env*` du dossier de l'app
(`apps/mobile/`) pour les variables préfixées `EXPO_PUBLIC_*` — **jamais**
le `.env.local` à la racine du repo (celui-ci contient des variables
serveur, `SUPABASE_SERVICE_ROLE_KEY` notamment, qui ne doivent **jamais**
entrer dans le bundle mobile).

Avant ce correctif, `apps/mobile/` n'avait **aucun** fichier `.env*` —
seul `apps/mobile/eas.json` (profil `preview`, utilisé par les builds EAS)
contenait les bonnes valeurs. Un simple `expo start` local ne les lisait
jamais : `Constants.expoConfig.extra.supabaseUrl` valait `""`,
`createClient("", "")` (`src/lib/supabase-client.ts`) levait une exception
**au chargement du module**, avant même le premier rendu React — l'app
plantait systématiquement au démarrage (écran d'erreur du dev-client, pas
de stack trace JS visible dans les cas testés).

**Corrigé** : `apps/mobile/.env.local` contient maintenant les mêmes
valeurs que `eas.json` (profil `preview`) — la clé anon Supabase est
publique (protégée par RLS côté serveur), jamais un secret. Fichier
gitignoré (`.env*` dans `.gitignore` racine, motif non ancré donc actif à
toute profondeur) — à recréer manuellement sur une nouvelle machine en
copiant les 3 valeurs de `eas.json` → `build.preview.env`.

## Lancer Metro

```bash
cd apps/mobile
pnpm start
```

`.env.local` est chargé automatiquement — pas besoin d'exporter quoi que ce
soit manuellement.

## Connecter un appareil physique via USB

1. `adb devices` doit lister l'appareil en état `device` (pas
   `unauthorized` — si c'est le cas, vérifier que le téléphone n'est pas en
   mode USB "Recharge uniquement" : basculer sur "Transfert de fichiers"
   dans la notification USB, puis réautoriser le débogage si demandé).
2. `adb reverse tcp:8081 tcp:8081`
3. Ouvrir le dev-client sur le téléphone, ou :
   ```bash
   adb shell am start -a android.intent.action.VIEW \
     -d "exp+dealradar-copilot://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
   ```
   **Utiliser `127.0.0.1`, jamais `localhost`** — Android peut échouer à
   résoudre le hostname `localhost` via `adb reverse` selon l'état réseau
   du téléphone ("Unable to resolve host 'localhost'"), alors que
   `127.0.0.1` (littéral, sans résolution DNS) fonctionne toujours.
4. Pour éviter que l'écran se reverrouille pendant une session de test
   prolongée : `adb shell svc power stayon usb` (à refaire après chaque
   reconnexion USB — ce n'est pas persistant).

## Android natif obsolète (`android/` désynchronisé)

Si un module natif fraîchement ajouté au projet (ex. `expo-crypto`,
`expo-camera`) provoque `Cannot find native module 'X'` au runtime alors
qu'il est bien dans `package.json` : le dossier `android/` (généré,
gitignoré, jamais commité) est probablement désynchronisé de
`app.config.ts`/`package.json`. Vérifier
`android/build/generated/autolinking/autolinking.json` (liste les paquets
avec code natif Android connus de la dernière config Gradle) — s'il manque
des entrées attendues :

```bash
cd apps/mobile
npx expo prebuild --clean --platform android
npx expo run:android
```

Rebuild complet (~10 min la première fois), 100% local, 0 CHF. Si
`expo run:android` échoue à installer l'APK à cause d'un souci `adb`
(serveur bloqué, USB déconnecté), l'APK est quand même produit — l'installer
manuellement :

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## SDK Android absent (nouvelle machine)

Voir l'historique de session pour la procédure complète (winget +
`sdkmanager` + licences) — résumé :

```bash
winget install --id Google.AndroidStudio -e --silent --accept-package-agreements --accept-source-agreements
winget install --id EclipseAdoptium.Temurin.17.JDK -e --silent --accept-package-agreements --accept-source-agreements
```

Puis télécharger `commandlinetools` depuis
`https://developer.android.com/studio#command-line-tools-only`, extraire
sous `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\`, définir
`ANDROID_HOME`/`ANDROID_SDK_ROOT`, et installer via `sdkmanager` :
`platform-tools`, `platforms;android-35`, `build-tools;35.0.0`. 0 CHF,
100% local.

## Avertissement "pages de 16 Ko" (Android, dev-only)

Sur un appareil récent (ex. Samsung S24 Ultra), un build debug affiche au
premier lancement une boîte de dialogue "Compatibilité des applis Android —
Cette appli n'est pas compatible avec les pages de 16 Ko", listant :
`libexpo-modules-core.so`, `libhermestooling.so`, `libhermes.so`,
`libnative-filters.so`, `libgifimage.so`, `libstatic-webp.so`,
`libreactnative.so`, `libfbjni.so`, `libc++_shared.so`,
`libandroidx.graphics.path.so`, `libnative-imagetranscoder.so`,
`libimagepipeline.so`, `libjsi.so`.

- **Versions actuelles** : `expo` ~52.0.11, `react-native` 0.76.9,
  `expo-camera` ~16.0.18.
- **Cause** : Android 15 (API 35) introduit la possibilité d'une taille de
  page mémoire de 16 Ko (au lieu de 4 Ko historiquement) sur certains
  appareils/noyaux. Les bibliothèques natives (`.so`) listées ci-dessus,
  telles que compilées pour ce lot (NDK/outillage de build associés à Expo
  SDK 52 / RN 0.76), n'ont pas leurs segments `LOAD` alignés sur 16 Ko —
  d'où l'avertissement.
- **Impact réel constaté sur ce Samsung** : **aucun** — dialogue purement
  informatif, "OK"/"Ne plus afficher", réapparaît à chaque lancement dans
  un build debug/débogable tant qu'on ne coche pas "Ne plus afficher" ; le
  fonctionnement de l'app (caméra, capture, navigation) n'est pas affecté.
  Ce Samsung fonctionne encore avec une taille de page 4 Ko — l'app tourne
  normalement.
- **Dev-only vs futur Play Store** : cet avertissement système ne
  s'affiche que pour une appli **débogable** en cours de test (le message
  le dit explicitement : "il s'agit d'une application débogable qui est
  actuellement testée"). Google a publiquement annoncé une exigence de
  compatibilité 16 Ko pour les nouvelles soumissions/mises à jour Play
  Store à terme — la date exacte applicable à ce projet n'a pas été
  vérifiée ici et doit être reconfirmée sur la documentation officielle
  Android avant toute publication réelle, plutôt que supposée.
- **Version minimale qui corrigerait probablement cela** : non vérifié
  précisément dans ce lot — passer à une version d'Expo SDK/React Native
  plus récente que celle utilisée ici (ce qui inclurait des builds natifs
  d'Hermes/expo-modules-core/etc. réalignés) est la piste correcte, mais
  **aucune montée de version majeure n'a été effectuée ni testée** — à
  planifier comme un lot dédié, pas une correction ad hoc.
- **Priorité** : **BEFORE STORE** — sans impact sur le développement/tests
  actuels (BLOCKER : non ; BEFORE BETA : non — l'app interne n'est jamais
  publiée sur le Play Store) ; à traiter avant toute soumission Play Store
  réelle, jamais avant.
