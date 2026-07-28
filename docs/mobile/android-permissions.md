# Matrice des permissions Android — Copilote

Chaque permission ci-dessous est demandée **au moment où elle devient
nécessaire**, jamais au premier lancement. Aucune n'est demandée si
l'utilisateur n'active jamais le Copilote — l'application fonctionne sans
aucune de ces permissions pour l'usage « découverte d'opportunités ».

## `SYSTEM_ALERT_WINDOW` (afficher par-dessus les autres applications)

- **Finalité** : afficher la bulle flottante déplaçable pendant que le
  Copilote est actif.
- **Moment de la demande** : quand l'utilisateur appuie sur « Activer le
  Copilote », jamais avant.
- **Texte de consentement** : « DealRadar affichera une bulle par-dessus vos
  autres applications tant que le Copilote est actif. Appuyez dessus quand
  une annonce vous intéresse — rien n'est analysé sans votre action. »
- **Comportement si refus** : le Copilote reste désactivé, aucune bulle,
  aucun service démarré ; le reste de l'app fonctionne normalement.
- **Donnée collectée** : aucune par cette permission seule (l'overlay
  n'observe rien, il affiche un bouton).
- **Durée de conservation** : sans objet.
- **Risque Google Play** : modéré-élevé si mal justifié — Play exige une
  finalité claire et une désactivation facile. Mitigé par un bouton
  d'arrêt visible en permanence dans la bulle et dans l'app.
- **Alternative moins sensible envisagée** : notification persistante avec
  action rapide au lieu d'une bulle — rejetée pour ce lot car elle
  dégraderait fortement l'ergonomie (retour à l'app à chaque annonce), à
  reconsidérer si Play la refuse en pratique.

## `MediaProjection` (capture d'écran ponctuelle)

- **Finalité** : capturer l'écran courant, une seule fois, au moment où
  l'utilisateur appuie sur la bulle.
- **Moment de la demande** : dialogue système déclenché à chaque premier
  appui après activation (ou par session, selon comportement OS — jamais
  mémorisé silencieusement au-delà de ce que l'OS impose lui-même).
- **Texte de consentement** : géré par le dialogue système Android
  (« DealRadar veut démarrer la capture ou la diffusion d'écran ») —
  complété côté app par un écran explicatif avant de déclencher ce
  dialogue : « Nécessaire pour capturer l'annonce affichée. La capture est
  supprimée après analyse ou en cas d'annulation. »
- **Comportement si refus** : la bulle reste affichée mais l'analyse par
  capture est indisponible pour cette session ; aucune tentative de
  contournement (pas d'`AccessibilityService` de repli).
- **Donnée collectée** : une image bitmap de l'écran au moment T.
- **Durée de conservation** : capture brute supprimée localement après
  upload réussi, après échec, après annulation, ou après timeout — jamais
  conservée par défaut (voir `privacy-and-retention.md`).
- **Risque Google Play** : élevé si perçu comme surveillance — mitigé par
  le caractère strictement ponctuel (un appui = une capture, jamais de
  boucle), l'indicateur système Android déjà obligatoire pendant la
  capture, et l'absence de toute capture hors du gestionnaire de clic de
  la bulle (vérifiable dans le code du spike).
- **Alternative moins sensible** : aucune sur Android pour ce cas d'usage
  précis — c'est l'API prévue par Google pour une capture ponctuelle
  consentie.

## Foreground service (+ `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION` sur Android 14+)

- **Finalité** : maintenir la bulle et la capacité de capture actives
  pendant que l'utilisateur navigue dans une autre application, avec une
  notification permanente obligatoire indiquant que le Copilote tourne.
- **Moment de la demande** : démarré uniquement quand l'utilisateur active
  le Copilote ; arrêté immédiatement sur action « Désactiver ».
- **Texte de consentement** : porté par la notification persistante
  elle-même (« Copilote DealRadar actif — appuyez pour désactiver »),
  visible en permanence, non masquable tant que le service tourne.
- **Comportement si refus** : impossible de refuser indépendamment de
  `SYSTEM_ALERT_WINDOW` — fait partie du même flux d'activation.
- **Donnée collectée** : aucune par le service lui-même.
- **Durée de conservation** : sans objet — le service ne persiste aucune
  donnée, il maintient seulement le processus actif.
- **Risque Google Play** : modéré — type de service (`mediaProjection`)
  doit être déclaré explicitement dans le manifeste (obligatoire Android
  14+ / `targetSdk 34`+), sans quoi le déclenchement de la projection
  échoue au runtime avant même la review Play.
- **Alternative moins sensible** : aucune — un foreground service est la
  seule façon conforme de garder un processus actif visible pendant une
  capture potentielle hors de l'app.

## `POST_NOTIFICATIONS` (Android 13+)

- **Finalité** : afficher la notification permanente du foreground service
  et le résultat compact après analyse.
- **Moment de la demande** : au moment d'activer le Copilote (nécessaire
  pour afficher sa propre notification de service).
- **Comportement si refus** : sur Android 13+, un foreground service peut
  démarrer sans notification visible à l'utilisateur si la permission est
  refusée — **inacceptable pour ce produit** (violerait la règle
  « indicateur visible obligatoire ») : si refusée, le Copilote ne
  s'active pas et l'app l'explique clairement plutôt que de démarrer un
  service invisible.
- **Donnée collectée** : aucune.
- **Durée de conservation** : sans objet.
- **Risque Google Play** : faible.
- **Alternative** : aucune pertinente — la notification est elle-même la
  garantie de transparence exigée par la règle produit.

## Caméra (`CAMERA`)

- **Finalité** : photographier un objet (brocante, objet non listé en
  ligne) pour analyse.
- **Moment de la demande** : au premier usage de « Scanner avec la
  caméra », jamais avant.
- **Comportement si refus** : fonctionnalité caméra indisponible ; upload
  depuis Photos et partage restent utilisables.
- **Donnée collectée** : une photo, envoyée pour analyse puis supprimée
  localement après upload (comportement identique à la capture d'écran).
- **Risque Google Play** : faible pour un usage ponctuel déclaré et
  justifié dans la fiche Data Safety.

## Photos/Médias (`READ_MEDIA_IMAGES` / accès scoped storage)

- **Finalité** : importer une capture d'écran ou une photo existante
  depuis la galerie.
- **Moment de la demande** : au premier usage d'« Importer depuis Photos ».
- **Comportement si refus** : import indisponible, partage direct depuis
  l'app photo (Share Extension équivalente Android via Intent) reste
  possible sans cette permission.
- **Risque Google Play** : faible avec l'API de sélection scoped
  (`ACTION_PICK`/Photo Picker) qui ne nécessite pas la permission large
  sur Android 13+.

## Réseau (`INTERNET`, implicite)

- **Finalité** : appeler `POST/GET /v1/analyses`.
- **Donnée collectée/transmise** : voir `privacy-and-retention.md`.
- **Risque Google Play** : nul — permission normale, non sensible.

## Checklist manuelle du spike (émulateur/appareil)

Puisque l'automatisation instrumentée (Espresso) de ces flux dépasse le
périmètre de ce lot, la vérification native passe par cette checklist
manuelle sur l'émulateur/appareil utilisé pour le spike :

- [ ] Activer le Copilote → dialogue `SYSTEM_ALERT_WINDOW` apparaît.
- [ ] Refuser → aucune bulle, aucun service, message explicatif affiché.
- [ ] Accepter → bulle visible, déplaçable, notification de service visible.
- [ ] Appuyer sur la bulle → dialogue `MediaProjection` apparaît.
- [ ] Refuser → aucune capture, bulle reste utilisable.
- [ ] Accepter → capture unique déclenchée, aperçu local affiché.
- [ ] Double-tap rapide sur la bulle → une seule capture déclenchée (pas de doublon).
- [ ] Verrouiller l'écran pendant une capture en cours → comportement sans crash.
- [ ] Appuyer sur « Désactiver » → bulle disparaît, service et notification s'arrêtent.
- [ ] Après désactivation, aucune capture résiduelle sur disque.
