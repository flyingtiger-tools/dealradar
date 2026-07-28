# Conformité stores — préparation (aucune publication dans ce lot)

## Google Play Data Safety (préparation)

| Donnée | Collectée | Partagée avec des tiers | Finalité | Chiffrement en transit | Suppression possible | Facultatif/obligatoire |
|---|---|---|---|---|---|---|
| Capture d'écran / photo | Oui (temporaire) | Non — traitement interne uniquement (+ appel à un provider IA texte/vision pour l'extraction, cf. ADR 0009) | Fonctionnalité de l'app (analyse d'annonce) | Oui | Oui (immédiate sur demande, automatique après traitement) | Facultatif — nécessaire uniquement si l'utilisateur active le Copilote/scanner |
| URL partagée | Oui | Non (sauf provider IA si le texte de la page est transmis pour extraction) | Fonctionnalité de l'app | Oui | Oui | Facultatif |
| Résultat d'analyse (produit, prix, scores) | Oui | Non | Fonctionnalité de l'app | Oui | Oui | Résultant d'une action facultative |
| Identifiant de compte / e-mail | Oui (déjà collecté par l'auth existante) | Non | Compte utilisateur | Oui | Oui (suppression de compte) | Obligatoire pour utiliser l'app |

Aucune donnée de localisation précise, contact, ou identifiant publicitaire
n'est collectée par ce lot.

## Apple App Privacy (nutrition label — préparation)

Catégories concernées : **Contenu utilisateur** (photos/captures liées à
l'utilisateur, non liées à son identité au-delà du compte), **Identifiants**
(compte), **Diagnostics** (télémétrie technique existante,
`packages/ai/src/observability/telemetry.ts`, sans donnée personnelle).
Non utilisées à des fins de suivi publicitaire inter-app
(`App Tracking Transparency` non concerné par ce lot — aucun tracking
publicitaire mis en place).

## Justification de la Share Extension (App Review)

Texte de justification prévu pour App Review : « DealRadar propose une
extension de partage qui reçoit uniquement le contenu que l'utilisateur
partage explicitement depuis une autre application (URL, texte, image, ou
capture d'écran) via le mécanisme de partage standard d'iOS. L'extension
n'accède à aucune autre donnée de l'application source, ne s'exécute pas en
arrière-plan, et ne collecte rien sans cette action explicite de
partage. » Procédure de test reviewer : compte de démonstration (à créer
avant soumission réelle, hors périmètre de ce lot) + instructions pas à
pas reprenant le plan de test de `ios-share-extension.md`.

## Justification Android (`SYSTEM_ALERT_WINDOW` / `MediaProjection`)

Texte prévu pour la fiche Play / la review : « La bulle flottante et la
capture d'écran ponctuelle ne s'activent que si l'utilisateur active
explicitement le Copilote et appuie sur la bulle. Une notification
persistante indique en permanence que le Copilote est actif, avec un
bouton d'arrêt immédiat. Aucune capture n'a lieu sans cette action, et
aucune donnée n'est lue en continu. » Procédure de test reviewer : même
principe, compte de démonstration + checklist de
`android-permissions.md`.

## Éléments encore à produire avant soumission réelle (hors périmètre de ce lot)

Compte de démonstration/mode démo, capture vidéo du flux pour le reviewer,
politique de confidentialité publiée (URL publique), remplissage effectif
des formulaires Play Console Data Safety et App Store Connect Privacy —
ce document prépare le contenu, ne le soumet pas.
