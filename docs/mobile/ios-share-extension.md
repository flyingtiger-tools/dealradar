# Share Extension iOS

**Statut d'implémentation : UNVERIFIED — requires macOS/Xcode or EAS Build.**
Cette machine n'a pas macOS/Xcode — aucun moyen de contourner cette
contrainte localement (voir ADR 0010). Ce document décrit la conception et
le plan de test ; la vérification réelle nécessite un Mac (local ou via
EAS Build) et un compte Apple Developer pour la signature.

**Audit statique effectué** (fichiers présents, App Group cohérent entre
`app.config.ts`/le config plugin/le Swift, Bundle ID cohérent, aucun
secret, aucune API privée Apple détectée) — voir
`docs/mobile/lot1-final-report.md` pour le détail. Deux lacunes réelles
trouvées et corrigées par relecture (jamais compilées pour le confirmer) :
la cible d'extension n'avait pas de `PRODUCT_BUNDLE_IDENTIFIER` explicite
(obligatoire, nesté sous celui de l'app principale :
`com.dealradar.mobile.ShareExtension`), et son fichier d'entitlements
(App Group) n'était jamais généré sur disque — `plugins/withIosShareExtension.js`
corrigé en conséquence.

## Fonctionnement cible

1. L'utilisateur voit une annonce dans Safari, Facebook Marketplace,
   Photos, etc.
2. Il appuie sur « Partager » → choisit « DealRadar ».
3. iOS lance la Share Extension avec ce que l'app source a réellement
   fourni (`NSExtensionItem` : URL, texte, image, ou capture d'écran selon
   le contexte de partage) — **jamais** une inspection du reste de
   l'application source.
4. La Share Extension écrit les données reçues dans le conteneur App Group
   partagé (`group.com.dealradar.mobile`), affiche un résultat compact si
   le réseau est disponible, sinon un état « en attente ».
5. Un deep link (`dealradar://analysis/:id` ou un identifiant de requête en
   attente) permet d'ouvrir l'app principale sur la fiche complète.

## Fichiers du spike

- `apps/mobile/plugins/withIosShareExtension.js` — config plugin Expo qui
  ajoute une cible d'extension au projet Xcode généré par
  `expo prebuild` (`withXcodeProject`), déclare l'App Group, et copie les
  fichiers source de l'extension dans le projet natif généré.
- `apps/mobile/ios/ShareExtension/ShareViewController.swift` — reçoit les
  `NSExtensionItem`, distingue URL / texte / image via
  `NSItemProvider.hasItemConformingToTypeIdentifier`, écrit un payload JSON
  minimal dans `UserDefaults(suiteName: appGroup)`, tente un appel réseau
  direct vers `POST /v1/analyses` si un token valide est présent dans le
  keychain partagé, sinon marque la requête « en attente » pour que l'app
  principale la reprenne à l'ouverture.
- `apps/mobile/ios/ShareExtension/Info.plist` — déclare les types
  acceptés (`NSExtensionActivationSupportsWebURLWithMaxCount`,
  `NSExtensionActivationSupportsImageWithMaxCount`,
  `NSExtensionActivationSupportsText`) avec des maximums de 1, pour rester
  strictement dans le cas d'usage « une annonce à la fois ».

## Ce que l'extension reçoit — et rien d'autre

Uniquement le contenu que l'utilisateur a explicitement choisi de partager
via `UIActivityViewController`/le menu de partage système. Aucune API iOS
store-compliant ne permet à une Share Extension d'inspecter le reste de
l'application source, son état, ou son historique — ce n'est donc pas
seulement une politique produit, c'est une contrainte de la plateforme.

## Prévu également (mêmes principes, hors cible d'extension)

- **Partage d'une capture d'écran** : capturée par l'utilisateur via le
  raccourci système iOS, partagée ensuite comme une image normale — même
  chemin que « partage d'image ».
- **Import depuis Photos** : dans l'app principale, `PHPickerViewController`
  (ne demande aucune permission de bibliothèque complète depuis iOS 14).
- **Scanner avec la caméra** : dans l'app principale, `AVCaptureSession`
  standard, déclenché explicitement.
- **Deep link vers la fiche complète** : schéma custom + Universal Link de
  secours.

## ReplayKit — explicitement différé

ReplayKit permettrait une diffusion d'écran continue plutôt qu'une capture
ponctuelle par partage. Il n'est nécessaire à aucun flux de ce lot et
présente un risque de review Apple plus élevé (une diffusion d'écran
continue ressemble structurellement à de la surveillance, même consentie).
Reste une expérimentation future non bloquante — voir ADR 0010.

## Plan de test (à exécuter sur macOS)

- [ ] Extension visible dans la feuille de partage depuis Safari (URL).
- [ ] Extension visible depuis Photos (image).
- [ ] Réception correcte d'une URL partagée depuis Safari.
- [ ] Réception correcte d'une image partagée depuis Photos.
- [ ] Réception correcte d'une capture d'écran partagée juste après
      capture système.
- [ ] Comportement sans réseau : la requête est mise en attente, pas
      perdue, pas de crash de l'extension.
- [ ] Timeout réseau pendant l'extension : dégradation propre, pas de
      blocage de l'UI de partage au-delà des limites imposées par iOS
      (l'OS tue une extension qui prend trop de mémoire/temps).
- [ ] Annulation par l'utilisateur en cours de partage : aucune donnée
      retenue au-delà de ce que l'OS nettoie lui-même.
- [ ] Ouverture de l'app principale via deep link après une requête en
      attente : la fiche complète apparaît une fois l'analyse terminée.
- [ ] Aucune rétention de la capture/image au-delà du traitement de la
      requête (voir `privacy-and-retention.md`).

## Ce qu'il reste à faire avant que ce spike soit considéré prouvé

Build sur un Mac (local ou EAS Build cloud) avec un compte Apple Developer
pour la signature de l'App Group et de l'extension, exécution du plan de
test ci-dessus sur simulateur ou appareil réel, capture des résultats.
Aucune affirmation de ce document ne doit être lue comme « testé » tant
que cette étape n'a pas eu lieu.
