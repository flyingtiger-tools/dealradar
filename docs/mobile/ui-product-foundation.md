# Fondation produit UI — Raf, navigation, écrans (2026-09-15)

Doc opérationnelle (LOT "fondation produit Raf, avancer sur le produit
visible pendant que le test Groq attend"). Le pipeline photo→prix
(`TcgScanScreen`, `tcg-adapter.ts`, `POST /api/internal/tcg/analyze`,
Groq, TCGdex/JustTCG) n'a **pas été modifié** par ce lot — seule sa
présentation a changé (voir "Ce qui n'a pas changé" plus bas).

## Navigation finale

5 onglets consommateur (`src/navigation/RootNavigator.tsx` +
`BottomTabBar.tsx`) :

```
Accueil · Historique · Scanner (bouton central surélevé) · Favoris · Profil
```

Implémentation "maison" (état React, `View`/`Pressable`) — **volontairement
sans `@react-navigation`** : ajouter une bibliothèque de navigation native
aurait exigé une régénération native (`expo prebuild`) invérifiable dans
cet environnement aujourd'hui (voir "Blocage APK" plus bas). Aucune autre
dépendance native n'a été ajoutée non plus (pas de `react-native-svg`, pas
de librairie d'animation — `Animated` natif de React Native suffit pour le
press-feedback et la pulsation Raf).

Écrans "poussés" (`PushedScreen`), jamais dans la barre d'onglets,
accessibles uniquement depuis **Profil → Outils internes**, et seulement
sous `EXPO_PUBLIC_INTERNAL_TOOLS=true` ou `__DEV__` :

- **Dataset TCG** (`TcgDatasetCaptureTool.tsx`, inchangé)
- **UI Preview** (nouveau, Phase 15)
- **Build info** (nouveau, Phase 14)
- **Capture universelle (bêta)** (`UniversalCaptureBetaScreen.tsx`, inchangé)
- **Copilote (spike)** (déplacé depuis `App.tsx`, logique inchangée)
- **Onboarding (aperçu)** (structure prête, pas encore branchée sur le flux réel)

### Décision de placement : Capture universelle et Copilote

Ni l'une ni l'autre n'était explicitement nommée dans les 5 onglets
demandés. Les deux sont des fonctionnalités réelles mais bêta/preuve de
concept (leurs propres commentaires de code le disent : "ne remplace
jamais TcgScanScreen" pour la première, "spike" pour la seconde) — elles
ont donc été rangées sous Outils internes plutôt que supprimées ou
laissées comme onglets principaux, cohérent avec l'esprit "Dataset TCG ne
doit PAS être dans la navigation principale" appliqué à tout ce qui n'est
pas le flux consommateur. Décision mineure prise sans validation, comme
demandé.

**Effet de bord documenté** : le Copilote s'abonnait auparavant à
`subscribeToBubbleTapped` au niveau racine de `App.tsx` (toujours monté,
quel que soit l'onglet actif). Il ne s'abonne maintenant que pendant que
`CopilotScreen` est affiché. Le service Android natif (bulle flottante,
`overlay-copilot`) continue de tourner indépendamment ; seule la réaction
JS à un tap sur la bulle nécessite maintenant que l'écran Copilote soit
ouvert. Acceptable pour une feature déjà classée "spike" ; à revoir si le
Copilote redevient une fonctionnalité de premier plan.

## Design tokens (`src/theme/tokens.ts`)

Thème sombre uniquement (aucune bascule clair/sombre aujourd'hui — aucun
écran ne lit `useColorScheme()`). Couleurs/espacements/rayons/typographie/
ombres centralisés ; aucun écran ne code une couleur en dur.

## Raf

### Assets réellement disponibles dans ce repo

**Aucun.** Recherche exhaustive effectuée sur tout le monorepo
(`apps/mobile`, et plus largement toute la racine du repo) : aucun
PNG/SVG/WebP Raf, aucun dossier `assets/`, `boards/`, `brand/`, `design/`
contenant quoi que ce soit lié à "Raf". Le seul dossier `assets/` trouvé
dans tout le repo est `.agents/skills/supabase/assets` (sans rapport).

### Assets manquants — architecture de remplacement

`src/assets/raf/registry.ts` (`getRafAsset(state)`) — placeholder emoji +
couleur de fond par état, zéro fichier image, zéro dépendance ajoutée.
Pour brancher les vrais visuels plus tard : déposer un fichier par état
sous `src/assets/raf/images/<state>.png` puis ne modifier QUE
`RAF_ASSETS` dans `registry.ts` — la signature de `getRafAsset()` et tous
ses appelants (`RafAvatar`, `RafIllustration`, etc.) restent inchangés.

### Registry (Phase 23) — les 12 états

`neutral · happy · clever · thinking · analyzing · searching · scanning ·
warning · badDeal · goodDeal · gem · megaDeal` — tous visualisables dans
Outils internes → UI Preview.

### Composants (Phase 24)

`RafAvatar` (portrait 32/48/96px), `RafIllustration` (grand, avec option
`pulse` — respiration d'échelle via `Animated`), `RafMessage` (bulle
courte), `RafEmptyState`, `RafResultHero`. Cinq composants, pas trente.

### Mapping unique (Phase 10) — `src/theme/raf-mapping.ts`

Deux familles de situations, jamais mélangées :

1. **Statut d'identification** (`identified`/`needs_confirmation`/
   `insufficient_data`/`failed`) — celle réellement produite par le scan
   carte TCG aujourd'hui.
2. **Palier de deal** (`bad`/`risk`/`average`/`good`/`excellent`/
   `exceptional`, dérivé de `decision`+`dealScore`, `@dealradar/
   contracts`) — **pas encore atteignable** par le scan TCG aujourd'hui
   (`RafAnalysis.decision`/`TcgCardAnalysisResult` ne portent aucune
   décision BUY/REVIEW/PASS, voir `identification/types.ts`). Existe pour
   le futur flux générique sans qu'aucune nouvelle logique de décision
   n'ait été inventée : ce fichier choisit un visuel à partir d'une
   décision déjà prise côté serveur, jamais l'inverse. Les fixtures DEMO
   d'UI Preview sont le seul endroit où ce chemin est exercé aujourd'hui.

## Écrans

### Home (Phase 4)

Header (marque + avatar Raf), hero ("On cherche une bonne affaire ?"),
deux CTA ("Scanner un produit" / "Importer une photo", tous deux ouvrent
l'onglet Scanner — qui propose déjà les deux méthodes de capture), puis
trois sections **volontairement en état vide** ("Dernières analyses" /
"Produits suivis" / "Alertes") — aucun backend d'historique, de favoris ou
d'alertes n'existe dans ce repo (vérifié, pas une omission). Aucune
donnée fabriquée.

### Scanner (Phase 5/6/7)

`TcgScanScreen.tsx` — **logique intacte** (même reducer
`tcg-scan-state.ts`, mêmes appels `uploadTcgCardPhoto`/`analyzeTcgCard`/
`createAnalysis`+`pollAnalysisUntilSettled`), seul le rendu a été extrait
vers des composants présentationnels :

- `CaptureGuideScreen` — cadre visuel (proportions carte TCG standard),
  conseil "sans reflet", boutons photo/galerie, repli saisie manuelle.
- `PreviewScreen` — photo + avertissements réels s'il y en a (aucun
  aujourd'hui pour ce flux — `TcgScanScreen` ne fait pas d'analyse de
  qualité, contrairement à Capture universelle) + Reprendre/Analyser.
- `AnalysisLoadingScreen` — **2 phases réelles seulement**
  ("Envoi de la photo…" / "Analyse en cours…"), jamais une séquence
  Identification/Catalogue/Marché/Prix fabriquée : le backend ne rapporte
  pas ces sous-étapes (une seule requête HTTP synchrone).
- `ConfirmationFormScreen` — même formulaire `providedTcgHints` qu'avant,
  juste restylé.

### Résultat (Phase 8/9/10/11/19)

`result-view-model.ts` — le seul mapper réel `TcgCardAnalysisResult` →
`ResultViewModel`, même règle qu'avant ("l'identité est le signal de
vérité, jamais `status` seul" — une carte identifiée sans prix exact
reste `identityStatus: "identified"`, jamais un échec, Phase 19).
`ResultScreen` : identité complète, prix par source (avec conversion
indicative et horodatage réel), Score et Confiance **affichés
séparément** (Phase 9 — `dealScore` est `null` pour tout résultat TCG
aujourd'hui, donc ce bloc n'affiche que la confiance), bandeau de verdict
**seulement si `decision` existe réellement**, panneau "Pourquoi ?" à
partir des `warnings` réels uniquement.

### Historique / Favoris (Phase 12/13)

États vides honnêtes — aucun backend, aucune donnée fabriquée, aucun
nouveau backend créé.

### Profil (Phase 14)

Compte / Préférences / À propos / Déconnexion. "Outils internes"
seulement sous `INTERNAL_TOOLS_ENABLED`.

### UI Preview (Phase 15/16)

Catalogue interne : tous les états Raf, boutons, verdicts, score/
confiance, empty/error states, et les **3 fixtures DEMO** rendues via le
vrai `ResultScreen` (badge "DEMO" visible). Seul consommateur autorisé de
`fixtures/demo-results.ts` — vérifié par un test structurel
(`navigation/__tests__/structure-isolation.test.ts`).

### Onboarding (Phase 21)

4 écrans (`OnboardingScreen.tsx`), structure complète, **pas branché** sur
le flux d'authentification — le brancher exige de décider où stocker
"déjà vu" (préférence locale ? profil Supabase ?), hors périmètre
aujourd'hui. Consultable depuis Outils internes en attendant.

## Ce qui n'a PAS changé (comme demandé)

- `POST /api/internal/tcg/analyze`, le choix Groq, `orchestratePokemonPipeline`,
  Railway : rien touché.
- `tcg-scan-state.ts`, `beta-result-state.ts`, `tcg-adapter.ts`,
  `identify-capture.ts` : rien touché.
- `TcgDatasetCaptureTool.tsx` : rien touché (sa propre garde
  `INTERNAL_TOOLS_ENABLED` reste en place, vérifié par test).
- `UniversalCaptureBetaScreen.tsx`/`UniversalCaptureScreen.tsx` : rien
  touché aujourd'hui (harmonisation visuelle non faite dans ce lot par
  manque de temps — reste une prochaine étape, voir plus bas).

## Blocage APK (Phase 31)

`apps/mobile/android/` reste verrouillé par un processus Windows externe
non identifiable à distance (déjà documenté dans une session précédente —
pas causé par ce lot, pas résolu par ce lot). Vérifié à nouveau
aujourd'hui :

- `subst` : aucun lecteur virtuel actif.
- Aucun processus `node`/`java`/`gradle` en cours.
- `Remove-Item -Force` sur le dossier échoue avec "utilisé par un autre
  processus" de façon stable (pas transitoire).

**Contournement appliqué pour vérifier le code quand même** :
`npx expo export --platform android` (bundle Metro/Hermes seul, sans
passer par `expo prebuild`/Gradle) — réussit, 704 modules bundlés,
confirmant que tout le nouveau code compile et se bundle correctement.
`pnpm build` (qui enchaîne `prebuild` puis `export`) échoue uniquement à
l'étape `prebuild`, à cause de ce verrou, pas d'une erreur de code.

Conformément à la consigne "ne perds pas 2 heures dessus" : pas de
nouvelle tentative de déblocage agressive. Résolution probable : fermer
l'application/fenêtre qui a ce dossier ouvert, ou redémarrer — nécessite
une présence physique.

## QA sur device (Phase 32)

`adb devices` : aucun appareil connecté au moment de la rédaction (le
Samsung n'est pas sur le même Wi-Fi que ce PC — reconnexion prévue ce
soir, voir la session précédente). QA différée en conséquence, sans
bloquer le reste du lot.

## Prochaines étapes

1. **Ce soir** (déjà planifié, session précédente) : reconnecter le
   Samsung en Wi-Fi, reconstruire l'APK interne (une fois le verrou
   `android/` levé), installer, puis QA visuelle réelle des écrans
   listés en Phase 32 (Home, Scanner, Preview, Result DEMO, Historique,
   Profil, Outils internes).
2. Harmoniser visuellement `UniversalCaptureBetaScreen`/
   `UniversalCaptureScreen` (Phase 29) — non fait aujourd'hui.
3. Une fois le test Groq réel effectué (voir
   `vision-provider-evaluation.md`), remplacer les warnings "aucun avertissement
   qualité" du flux `TcgScanScreen` en branchant, si pertinent, le moteur
   de qualité déjà présent côté Capture universelle (`quality-engine.ts`).
4. Décider où persister l'état "onboarding déjà vu" avant de le brancher
   sur le flux d'authentification réel.
5. Si de vrais assets Raf arrivent : ne modifier que
   `src/assets/raf/registry.ts` (voir "Assets manquants" ci-dessus).
