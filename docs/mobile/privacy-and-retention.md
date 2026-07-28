# Confidentialité et rétention — Copilote mobile

## Principes obligatoires (repris du brief produit, non négociables)

Consentement explicite avant toute capture · capture uniquement à la
demande · indicateur visible pendant que le Copilote Android est actif ·
aucune analyse silencieuse en arrière-plan · permissions demandées juste à
temps · bouton d'arrêt clair · bouton « Annuler et supprimer » · suppression
rapide de la capture brute · rétention minimale par défaut · aucune
conservation permanente par défaut · aucun stockage de notification
complète, de nom/téléphone/e-mail/conversation du vendeur · aucune capture
brute ni image en base64 dans les logs · aucun secret dans le client
mobile · chiffrement en transit · contrôle d'accès strict aux fichiers
temporaires.

## Carte des données

| Donnée | Où elle transite | Où elle est stockée | Durée | Qui y accède |
|---|---|---|---|---|
| Capture d'écran / photo brute | Client mobile → HTTPS → route `/v1/analyses` | Bucket privé Supabase Storage `analysis-uploads`, chemin préfixé par l'utilisateur | Jusqu'à fin de traitement (succès, échec, timeout, annulation) puis suppression — jamais conservée par défaut | Service role (worker) uniquement le temps du traitement |
| Résultat d'analyse (produit, prix, scores, décision) | Worker → table `analysis_requests.result` (jsonb) | Postgres, RLS `auth.uid() = user_id` | Rétention configurable côté produit (par défaut : historique limité, cf. brief section 14) — jamais illimitée par défaut dans ce lot | Utilisateur propriétaire uniquement (RLS), service role côté écriture |
| Métadonnées de requête (`sourceType`, `sourcePlatform`, `consentVersion`, `clientRequestId`) | Idem | Idem | Idem | Idem |
| Token d'authentification | Client → header `Authorization` | Jamais persisté côté serveur au-delà de la vérification de la requête ; côté client, stockage sécurisé plateforme (Keychain iOS / Keystore Android via une librairie de stockage sécurisé, jamais `AsyncStorage`/UserDefaults en clair) | Durée de vie du token Supabase (rotation via refresh token standard) | — |
| Contenu de notification/messages du vendeur | — | **Jamais collecté ni stocké** — hors du périmètre de la capture demandée à l'utilisateur (il ne partage/capture que l'annonce elle-même) | — | — |

## Ce qui n'est jamais collecté

Nom, téléphone, e-mail ou conversation du vendeur ; contenu de
notifications système (bancaires ou autres) apparaissant accidentellement
dans une capture — voir mitigation ci-dessous ; identité complète associée
à la clé de cache produit partagé (la clé ne contient jamais d'identifiant
utilisateur, de données personnelles, d'URL privée, ou de contenu non
nécessaire — hérité de la conception existante de
`packages/ai/src/cache/compute-key.ts`).

## Avant l'envoi serveur

- Le client mobile recadre la zone utile quand c'est possible (l'UI de
  prévisualisation post-capture permet un recadrage manuel avant envoi).
- La barre de statut et les notifications système sont naturellement hors
  du contenu capturé par `MediaProjection` dans la plupart des cas (la
  capture cible le contenu applicatif) ; l'écran de prévisualisation
  affiche explicitement à l'utilisateur ce qui va être envoyé, avec
  possibilité d'annuler s'il repère une donnée sensible visible (message,
  notification).
- OCR local et détection locale sont privilégiés dans le pipeline
  d'extraction (déterministe avant IA, cf. ADR 0009/0010) — moins de
  données transmises quand le texte est extractible sur l'appareil.
- Seul ce qui est nécessaire à l'analyse est transmis — jamais l'image
  brute complète si un recadrage ou une extraction locale suffisent.

## Politique de suppression automatique

Déclenchée sur chacun des événements suivants, appliquée à la fois côté
Storage (fichier brut) et côté client (fichier temporaire local) :

- Analyse terminée (`completed`/`insufficient_data`) → suppression du
  fichier brut du bucket après un court délai de grâce (relecture en cas
  d'échec de traitement), la donnée utile restant uniquement le résultat
  structuré.
- Erreur de traitement → suppression immédiate.
- Annulation utilisateur (bouton « Annuler et supprimer ») → suppression
  immédiate, y compris si une requête était déjà en vol.
- Timeout → suppression immédiate, statut marqué `failed`.
- Abandon de l'application (app tuée pendant une capture en cours) →
  aucune capture n'a été envoyée avant l'action explicite de l'utilisateur
  sur la bulle, donc rien à nettoyer côté serveur ; côté client, tout
  fichier temporaire non envoyé est supprimé au prochain lancement.
- Suppression de compte → purge de toutes les lignes `analysis_requests`
  de l'utilisateur et de tous les objets Storage sous son préfixe (job de
  suppression en cascade, même politique que `purge_expired_ai_cache()`
  existant pour le cache IA — voir migration 0012).

## Logs

Aucune capture brute, aucune image en base64, aucune URL signée complète
dans les logs applicatifs — même contrainte déjà respectée par
`packages/ai/src/image-policy/download-image-securely.ts` (jamais l'URL ni
le contenu binaire dans les logs), étendue au chemin mobile. Le logger
existant (`apps/workers/src/logger.ts`, pino) doit recevoir une règle de
rédaction (`redact`) explicite pour les champs `imageReferences`,
`sharedUrl`, `storageRef` avant que le job `analysis.process` ne logue quoi
que ce soit sur une requête d'analyse.

## Chiffrement et accès

HTTPS obligatoire de bout en bout (client → route Next.js → Supabase).
Fichiers temporaires locaux (avant upload) stockés dans le répertoire privé
de l'application (sandboxé par l'OS sur Android et iOS), jamais dans un
stockage partagé/public. Bucket Storage privé, policy propriétaire
uniquement (voir migration 0012).
