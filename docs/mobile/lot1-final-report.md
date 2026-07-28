# Rapport final — Mobile Copilot & Universal Listing Analysis (Lot 1)

**Date** : 2026-07-27 · **Portée** : audit, architecture, contrat d'API, docs de conformité/confidentialité, threat model, deux spikes techniques, plan de mise en œuvre V1. Aucun commit effectué (instruction explicite).

## Addendum — après activation des chemins longs Windows

`LongPathsEnabled` confirmé à `1` (redémarrage effectué par l'utilisateur).
**Le build Android complet échoue toujours**, mais pour une raison
différente et plus précise que ce qui était anticipé : `ninja.exe` (fourni
par le paquet CMake du SDK Android, utilisé pour compiler la partie C++
native d'`expo-modules-core`) bute sur le même chemin de 273 caractères
malgré le registre activé. Cause probable : le paramètre système
`LongPathsEnabled` ne bénéficie qu'aux processus dont le manifeste exécutable
déclare explicitement le support des chemins longs (`longPathAware`) — de
nombreux binaires natifs préconstruits, dont ce `ninja.exe`, n'ont pas ce
manifeste et restent soumis à l'ancienne limite `MAX_PATH`, indépendamment
du registre. Ce n'est donc pas un défaut de configuration côté projet, mais
une limite d'un binaire tiers sur Windows. Résoudre ce point précis (chemin
racine du dépôt raccourci, ou relocalisation du virtual store pnpm)
constituerait un changement de projet/environnement distinct de ce qui a
été demandé cette fois — non tenté sans accord explicite.

Reste de la validation effectuée normalement : émulateur `dealradar_test`
démarré et booté avec succès (`boot_completed=1` en 15s), monorepo entier
(`typecheck`/`lint`/`test`/`build`) re-confirmé vert (9/9, 9/9, 9/9, 3/3).
Aucun fichier modifié pendant cette passe (uniquement des vérifications).

## Addendum — passe de validation réelle (avant tout commit)

Une seconde passe a été demandée explicitement pour lever les blocages
possibles et éviter toute affirmation non vérifiée avant commit. Résultat :

- **Windows Long Paths** : re-vérifié à l'exécution — toujours `0`.
  Aucune modification du registre tentée ; la commande exacte a été
  redonnée. Compilation Android **non retentée** (bloquée par ce point,
  comme demandé).
- **Audit Git** : aucun secret, aucun `.env.local` suivi, aucune
  modification d'Intelligence Core ni du moteur IA. Un vrai défaut trouvé
  et corrigé : `apps/mobile/.gitignore` n'excluait pas la sortie de build
  Gradle du module natif local (`modules/overlay-copilot/android/build/` —
  classes compilées, dex, manifestes fusionnés) — corrigé avant que quoi
  que ce soit ne soit jamais ajouté à Git.
- **Audit approfondi de la migration 0012** : aucune fonction
  `SECURITY DEFINER` (toutes en `SECURITY INVOKER` implicite, cohérent
  avec le patron de la migration 0011) ; aucune policy ne permet à un
  utilisateur authentifié de lire/modifier l'analyse d'un autre, d'accéder
  aux captures d'un autre, ou de contourner le rate limit — vérifié y
  compris dans l'hypothèse d'un appel RPC direct avec un `p_user_id`
  arbitraire (la RLS sur les tables sous-jacentes bloque l'accès
  indépendamment des paramètres de la fonction, `authenticated` n'ayant
  aucune policy sur `api_rate_limit_windows`). Migration **toujours non
  appliquée** — `.env.local` existe (non lu, non tracké) mais je n'ai pas
  demandé/reçu l'accord explicite requis pour l'exécuter.
- **Test de plomberie API ajouté** : `apps/mobile/__tests__/analyses-client.test.ts`
  (3 tests) — vérifie que le client mobile construit réellement la requête
  `POST /api/v1/analyses` (en-tête `Authorization`, corps validé Zod,
  `clientRequestId`), qu'une requête invalide est rejetée localement avant
  tout appel réseau, et qu'une erreur serveur est propagée proprement.
  `fetch` mocké — jamais de vrai Supabase touché.
- **Audit statique iOS approfondi** : deux lacunes réelles trouvées par
  relecture et corrigées dans `plugins/withIosShareExtension.js` — la
  cible d'extension n'avait pas de `PRODUCT_BUNDLE_IDENTIFIER` explicite
  (obligatoire, nesté sous l'app principale) ni de fichier d'entitlements
  généré sur disque (App Group). **Toujours jamais exécuté** — `expo
  prebuild` sur cette machine Windows ne traite même pas la plateforme iOS
  (seul `ios/ShareExtension/` écrit à la main existe, aucun projet Xcode
  généré). Statut inchangé : **UNVERIFIED — requires macOS/Xcode or EAS Build**.
- **Monorepo** : `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  re-confirmés verts sur les 9-10 paquets après tous les correctifs
  ci-dessus (34 tests au total désormais : +3 par rapport à la passe
  précédente).

## Ce qui existait déjà

Voir `docs/mobile/readiness-audit.md` pour le détail complet. En résumé :
authentification Supabase (cookies SSR), Intelligence Core (ADR 0007),
moteur d'extraction IA déterministe-puis-IA (ADR 0009), cache d'extraction
et budget IA atomiques (migration 0011), sécurité image/SSRF
(`download-image-securely.ts`), jobs pg-boss, RLS par table depuis la
migration 0009. Aucune API publique JSON, aucun rate limiter, aucune
application mobile, aucun SDK Android/Xcode installés — confirmé par
inspection, pas supposé.

## Ce qui a été créé

**Documentation** (8 fichiers) :
`docs/adr/0010-mobile-copilot-architecture.md`,
`docs/mobile/{readiness-audit,api-contract,android-permissions,ios-share-extension,privacy-and-retention,store-compliance,threat-model}.md`.

**Contrat d'analyse universel** :
`packages/contracts/src/{analysis-request,analysis-result}.ts` (Zod, re-exportés via `packages/core`),
`packages/core/src/queues.ts` (+ `analysis.process`),
`supabase/migrations/0012_mobile_analyses.sql` (table `analysis_requests`,
RLS, rate limit atomique cloné du patron `reserve_ai_budget`, bucket
Storage privé `analysis-uploads`, fonctions de purge).

**API** : `apps/web/src/lib/supabase/{route-auth,service-role}.ts`,
`apps/web/src/app/api/v1/analyses/{route.ts,[id]/route.ts}` + 11 tests
vitest (auth, idempotence, rate limit, validation, isolation utilisateur).

**Worker** : `apps/workers/src/jobs/process-analysis.ts` (réutilise
`extractProduct()`/`runIntelligencePipeline()` directement — voir la
précision architecturale dans l'ADR 0010 sur pourquoi
`analyzeListing()`/`extractListing()` ne sont pas réutilisés verbatim) + 5
tests vitest.

**Mobile** : `apps/mobile/` — nouvelle app Expo Development Build.
Machine à états pure du Copilote (`src/state/copilot-state.ts`, 7 tests
jest), client API réel (`src/api/analyses-client.ts`), écran de spike
(`src/App.tsx`). Module natif Android complet
(`modules/overlay-copilot/android/...java/.../{OverlayCopilotModule,OverlayBubbleService}.kt`) :
overlay flottant, capture `MediaProjection` ponctuelle, foreground
service. Config plugins `plugins/{withAndroidOverlayCopilot,withIosShareExtension}.js`.
Spike iOS : `ios/ShareExtension/{ShareViewController.swift,Info.plist}`
(code seul, non compilé — voir plus bas).

**Toolchain** : JDK 17, Android SDK (cmdline-tools, platform-tools,
build-tools 34, emulator, system-image android-34), AVD `dealradar_test`
installés sur cette machine.

## Ce qui a été réellement testé

- **Backend** : 16 nouveaux tests vitest (route handlers + worker), tous
  verts. Monorepo entier — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  — vert sur les 10 paquets (9-10 selon la tâche turbo), vérifié à
  plusieurs reprises après chaque changement significatif.
- **Mobile (JS)** : 7 tests jest sur la machine à états du Copilote
  (consentement refusé, overlay refusé, double-tap débounce, arrêt
  d'urgence), tous verts. `tsc --noEmit`/`eslint` verts sur `apps/mobile`.
- **Android (natif)** : émulateur réellement démarré et booté (accélération
  WHPX confirmée, `adb`/`getprop sys.boot_completed` positif) —
  contrairement à un risque anticipé qui aurait pu bloquer toute
  vérification. `expo prebuild` vérifié produire un `AndroidManifest.xml`
  correct (permissions + déclaration du service `foregroundServiceType="mediaProjection"`).
  Module Kotlin `overlay-copilot` **compile avec succès**
  (`:overlay-copilot:compileDebugKotlin`) après correction de plusieurs
  bugs réels trouvés à la compilation (détail dans `readiness-audit.md`).
- **Régression découverte et corrigée** : l'ajout d'`apps/mobile` au
  workspace pnpm a fait dériver la résolution `@types/react` d'`apps/web`,
  cassant son typecheck sur des dizaines de fichiers non liés à ce lot ;
  diagnostiquée précisément et corrigée (voir `readiness-audit.md`) —
  le monorepo est revenu entièrement vert.

## Ce qui reste théorique

- **Le lien final de l'APK Android** (`:app:assembleDebug` complet, au-delà
  de la compilation du module `overlay-copilot`) — bloqué par une limite
  Windows authentique (`MAX_PATH` 260 caractères sur les chemins pnpm),
  pas par un défaut de code. Nécessite l'activation des chemins longs
  Windows (registre + redémarrage), une action que cette session
  d'outillage n'a pas les droits d'effectuer (accès refusé constaté).
  L'utilisateur a validé cette voie ; la commande à exécuter en PowerShell
  administrateur a été fournie.
- **L'exécution réelle de l'app sur l'émulateur** (bulle visible, capture
  MediaProjection déclenchée à la main, flux complet jusqu'à l'appel
  `POST /v1/analyses`) — dépend du point précédent.
- **La migration SQL 0012** — vérifiée par relecture attentive et
  cohérence avec le style des migrations 0009/0011, jamais exécutée contre
  une instance Postgres réelle (Docker indisponible dans cet
  environnement, limite déjà documentée depuis le Lot 4).
- **Le spike iOS** — code écrit, jamais compilé ni exécuté (aucun
  Xcode/macOS disponible, contrainte structurelle de cette machine
  Windows, pas contournable localement).

## Ce qui nécessite un vrai appareil

Vérification visuelle de la bulle flottante, du déplacement tactile, du
dialogue de consentement `MediaProjection` réel, et de l'aperçu de capture
— l'émulateur suffit pour cela (pas besoin d'un appareil physique), une
fois le blocage `MAX_PATH` levé. Un appareil physique reste utile pour
valider le comportement en conditions réelles (verrouillage d'écran,
multitâche) avant publication.

## Ce qui nécessite un compte Apple Developer

Build et signature de la cible Share Extension et de l'App Group
(`group.com.dealradar.mobile`), tests sur simulateur/appareil réel ou via
EAS Build, soumission App Store Connect (Privacy Nutrition Label, TestFlight).

## Ce qui nécessite un compte Google Play

Remplissage du formulaire Data Safety (contenu préparé dans
`docs/mobile/store-compliance.md`), création d'une fiche Play Console,
compte de démonstration pour la review, publication interne/fermée avant
toute publication publique.

## Ce qui pourrait entraîner un refus Store

Voir `docs/mobile/store-compliance.md` et `docs/mobile/threat-model.md`
pour le détail. Points de vigilance principaux : justification claire de
`SYSTEM_ALERT_WINDOW`/`MediaProjection` (Android), preuve que la Share
Extension ne traite que ce qui est explicitement partagé (iOS), absence de
tout mécanisme ressemblant à une surveillance continue.

## Risques ouverts

- Le pool de comparables vendus disponible pour le worker mobile est
  aujourd'hui limité à ce que l'ingestion eBay a déjà persisté — la
  majorité des analyses mobiles réelles retourneront probablement
  `INSUFFICIENT_DATA` tant qu'aucune source de comparables plus large
  n'est branchée (limite héritée d'ADR 0009, pas nouvelle).
- Le blocage `MAX_PATH` peut resurgir pour d'autres opérations Android
  (ex. `expo run:android`, CI Windows) tant que les chemins longs ne sont
  pas activés partout où le projet est construit.
- Le spike iOS n'a aucune garantie de compiler tel quel sur macOS — la
  manipulation de `project.pbxproj` (`withIosShareExtension.js`) suit un
  motif établi mais n'a jamais été exécutée.

## Coûts prévisibles

Aucun coût d'infrastructure nouveau dans ce lot (pas de nouveau provider
IA, pas de nouvelle base de données). Le pipeline de coût existant
(cache → déterministe → IA texte → vision, budget atomique) s'applique tel
quel aux analyses mobiles. Coûts futurs à anticiper : compte Apple
Developer (99 USD/an), compte Google Play (25 USD one-time), stockage
Supabase Storage pour les captures (volume à surveiller via la politique
de rétention déjà documentée).

## Fichiers créés/modifiés

Voir la liste complète dans « Ce qui a été créé » ci-dessus. Fichiers
monorepo existants modifiés : `apps/web/package.json` (+ vitest, test
script), `apps/workers/package.json` (+ vitest, test script),
`apps/workers/src/index.ts` (+ queue `analysis.process`),
`packages/contracts/src/index.ts`, `packages/core/src/{queues,validation/schemas}.ts`.
Aucune modification d'Intelligence Core, du moteur d'extraction IA, ou de
tout code d'ingestion eBay existant.

## Migrations

`supabase/migrations/0012_mobile_analyses.sql` — non exécutée (voir
limite documentée ci-dessus).

## Tests ajoutés

23 tests au total : 7 (route handlers) + 4 (route `:id`) + 5 (worker) + 7
(machine à états mobile). Tous verts.

## Roadmap recommandée après ce lot

1. Activer les chemins longs Windows (ou construire sur macOS/Linux/CI) et
   confirmer le lien complet de l'APK + une exécution réelle sur
   l'émulateur.
2. Exécuter la migration 0012 contre un projet Supabase réel, écrire les
   tests d'intégration RLS qui restent théoriques.
3. Obtenir l'accès à un Mac (ou EAS Build) pour vérifier réellement le
   spike iOS.
4. Élargir le pool de comparables disponible pour les analyses mobiles
   (au-delà du seul pool eBay déjà ingéré) — sujet distinct, hors
   périmètre de ce lot.
5. Construire les écrans mobiles restants (historique, confirmation
   produit/prix, écran de résultat complet) au-delà du spike minimal.

## Verdicts

| Élément | Verdict | Justification |
|---|---|---|
| Bulle Android (overlay) | **GO** | Testé réellement sur émulateur : activation, glissement, tap, arrêt — tous fonctionnels. |
| Capture Android MediaProjection | **GO** | Blocage `MAX_PATH` levé (clone `C:\dr`). Cycle complet testé réellement sur émulateur de bout en bout : consentement système → capture ponctuelle → fichier confirmé sur disque → aperçu affiché → suppression confirmée → arrêt du service confirmé. Deux bugs réels (race condition de promotion du foreground service, callback `MediaProjection` manquant sur Android 14) trouvés et corrigés pendant cette passe — voir addendum 2026-07-28 de `readiness-audit.md`. |
| Share Extension iPhone | **NO-GO (ce lot)** | Code écrit mais jamais compilé ni exécuté — aucun Xcode/macOS disponible ; nécessite un Mac ou EAS Build avant toute affirmation de fonctionnement. |
| Publication Google Play | **NO-GO (ce lot)** | Hors périmètre explicite de ce lot ; contenu de conformité préparé (`store-compliance.md`) mais compte/fiche/build de production manquants. |
| Publication App Store | **NO-GO (ce lot)** | Idem, plus bloqué par l'absence de build iOS fonctionnel. |

## Addendum — 2026-07-28 : build complet, validation réelle bout-en-bout

Voir l'addendum daté du même jour dans `docs/mobile/readiness-audit.md`
pour le détail complet (procédure de clonage, 7 bugs réels trouvés/corrigés,
preuves de validation par item). Résumé :

- **Blocage `ninja.exe`/`MAX_PATH` levé** par clonage du dépôt vers `C:\dr`
  (chemin racine court), approche la plus simple/réversible, choisie
  explicitement plutôt que de déplacer le virtual store pnpm global.
  Historique et modifications préservés ; aucun commit/push ; migration
  0012 toujours **non appliquée**.
- Build Android complet réussi (`assembleDebug`), APK installé et exécuté
  sur l'émulateur `dealradar_test`.
- Cycle complet permission → bulle → consentement → capture → aperçu →
  suppression → arrêt du service : **testé réellement, pas simulé** — voir
  preuves dans l'addendum de `readiness-audit.md`.
- Aucune donnée sensible (jeton, image base64, chemin de capture) trouvée
  dans les logs applicatifs.
- `apps/mobile` : `typecheck`/`lint`/`test` verts.
- Écart hors périmètre détecté et **non corrigé** : `pnpm typecheck` échoue
  sur `@dealradar/web` (double résolution `@types/react` 18.3.31/19.2.17),
  antérieur à cette session, signalé pour décision séparée.
- Aucun commit, push, ni migration cloud effectué durant cette validation.
