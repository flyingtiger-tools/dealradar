# Threat model — Copilote mobile

Chaque risque du brief produit, avec une mitigation concrète et testable.
« Existant » = mitigation déjà en place ailleurs dans le repo, réutilisée
telle quelle. « Nouveau » = ajouté par ce lot.

## 1. Capture contenant des messages privés

- **Mitigation** : écran de prévisualisation obligatoire avant envoi
  (le client affiche ce qui va être transmis, l'utilisateur peut annuler
  ou recadrer) ; capture strictement ponctuelle et déclenchée, jamais en
  continu, donc jamais capturée hors du contexte que l'utilisateur vient
  de regarder consciemment.
- **Test** : capture manuelle avec une notification de message visible à
  l'écran → vérifier que la prévisualisation la montre et permet
  l'annulation avant tout envoi réseau. *(Nouveau)*

## 2. Capture contenant une notification bancaire

- **Mitigation** : identique au point 1 — prévisualisation + annulation.
  Aucune notification bancaire n'est jamais transmise sans passer par cet
  écran de confirmation.
- **Test** : idem point 1. *(Nouveau)*

## 3. Image contenant un numéro de téléphone

- **Mitigation** : le pipeline d'extraction ne cible que les champs
  produit (nom, prix, référence) — un numéro de téléphone visible n'est
  jamais extrait comme donnée exploitée. Le motif de rédaction de numéro
  de série déjà en place (`prompts/build-prompt.ts`,
  `redactSerialNumberMentions`, ADR 0009) établit le précédent : étendre la
  même logique de rédaction aux motifs de numéro de téléphone dans le
  texte envoyé au provider IA.
- **Test** : fixture contenant un numéro de téléphone dans le texte →
  vérifier son absence du prompt envoyé au provider et du résultat final.
  *(Existant pour numéro de série, extension nouvelle pour téléphone)*

## 4. Envoi accidentel d'une mauvaise capture

- **Mitigation** : bouton « Annuler et supprimer » toujours visible sur
  l'écran de prévisualisation avant envoi ; après envoi, suppression
  rapide de la capture brute côté serveur dès traitement terminé, donc
  fenêtre d'exposition minimale même en cas d'erreur utilisateur.
- **Test** : annuler après capture, avant envoi → vérifier qu'aucune
  requête réseau n'a eu lieu. *(Nouveau)*

## 5. Appareil compromis

- **Mitigation** : hors périmètre de la sécurité applicative — un appareil
  root/jailbreak compromis peut intercepter n'importe quelle app. Mitigé
  au niveau architecture par : jamais de secret embarqué dans le client
  (voir point 7), token à durée de vie limitée avec rotation par refresh
  token, stockage du token dans le Keychain/Keystore plutôt qu'en clair.
- **Test** : revue de code confirmant l'absence de secret statique dans
  `apps/mobile`. *(Nouveau, contrôle de revue)*

## 6. Token mobile volé

- **Mitigation** : token Supabase à durée de vie courte, refresh token
  géré par le SDK Supabase standard (rotation), révocation possible côté
  Supabase Auth (déconnexion à distance via l'admin existant). RLS
  garantit qu'un token volé ne donne accès qu'aux données de l'utilisateur
  concerné, jamais à celles d'un autre.
- **Test** : vérifier que `GET /v1/analyses/:id` retourne 404 (pas 403,
  pour ne pas confirmer l'existence) pour l'id d'un autre utilisateur.
  *(Nouveau, test route handler)*

## 7. Réutilisation abusive de l'endpoint d'analyse

- **Mitigation** : authentification obligatoire sur toutes les routes
  `/v1/analyses` (pas d'endpoint anonyme) ; rate limiting par utilisateur
  (`check_and_increment_rate_limit`, migration 0012, patron cloné de
  `reserve_ai_budget` — verrou atomique, pas un compteur applicatif
  course-condition-prone).
- **Test** : dépasser la limite → `429` avec `Retry-After`, aucune requête
  supplémentaire enfilée dans la queue. *(Nouveau, test route handler)*

## 8. Spam automatisé

- **Mitigation** : même rate limit que le point 7, appliqué par
  utilisateur authentifié — un compte spammeur est limité indépendamment
  du nombre d'appareils qu'il utilise (clé = `user_id`, pas
  `device_id`/IP, plus difficile à contourner par rotation d'appareil).
- **Test** : idem point 7. *(Nouveau)*

## 9. Facture IA provoquée volontairement

- **Mitigation** : budget IA atomique déjà existant
  (`reserve_ai_budget`/`finalize_ai_budget`/`release_ai_budget`, migration
  0011) s'applique au chemin mobile exactement comme au chemin
  d'ingestion eBay — un budget journalier insuffisant retourne `null` et
  bloque l'appel réseau IA avant qu'il n'ait lieu, jamais après coup.
  Combiné au rate limit par utilisateur (point 7) et au cache produit
  partagé (une même analyse ne re-déclenche jamais un appel IA).
- **Test** : `budget-concurrency.test.ts` existant (ADR 0009) + nouveau
  test worker vérifiant qu'un budget épuisé produit un statut
  `insufficient_data` plutôt qu'un appel bloquant/en boucle. *(Existant +
  Nouveau)*

## 10. Upload trop volumineux

- **Mitigation** : taille maximale stricte déjà implémentée dans
  `download-image-securely.ts` (plafond de taille lors du téléchargement) ;
  étendue à l'upload direct mobile par une limite de taille de payload sur
  la route (`413 PAYLOAD_TOO_LARGE`) avant toute écriture Storage.
- **Test** : payload au-delà du plafond → `413`, aucune écriture Storage
  déclenchée. *(Existant, pattern étendu — Nouveau côté route)*

## 11. Fichier malveillant déguisé en image

- **Mitigation** : détection MIME par octets magiques déjà implémentée
  (`detectMimeFromBytes()`, `MAGIC_BYTES`, `download-image-securely.ts`) —
  jamais une confiance dans l'en-tête `Content-Type` déclaré ou
  l'extension de fichier. Le client mobile uploade directement vers le
  bucket `analysis-uploads` (RLS propriétaire, migration 0012) ; le worker
  réutilise cette même détection **au moment où il lit l'image pour
  l'extraction IA** (paresseux, comme le chemin eBay existant), jamais une
  confiance dans le type déclaré au moment de l'upload.
- **Test** : `download-image-securely.test.ts` existant couvre déjà ce cas
  (fixture `JPEG_MAGIC`) ; nouveau test worker vérifiant le rejet d'un
  contenu dont les octets magiques ne correspondent pas à une image
  supportée, avec passage en `INSUFFICIENT_DATA` plutôt qu'un crash.
  *(Existant + Nouveau)*

## 12. SSRF via URL partagée

- **Mitigation** : ce lot **ne récupère jamais `sharedUrl` côté serveur** —
  elle est stockée comme métadonnée (utile pour un futur connecteur ou pour
  l'affichage), jamais fetchée (aucun scraping de marketplace introduit par
  ce lot). La seule surface réseau sortante liée à une image est
  `imageReferences`, et ces références sont validées comme pointant dans
  le bucket privé `analysis-uploads` sous le préfixe de l'utilisateur —
  jamais une URL externe arbitraire. Si un futur lot ajoute la récupération
  d'une `sharedUrl` (connecteur générique, extraction depuis une page web),
  il devra obligatoirement passer par `download-image-securely.ts`
  (résolution DNS + rejet IP privée/RFC-1918/métadonnées cloud, connexion
  épinglée sur l'IP validée) déjà implémenté et testé (ADR 0009) — jamais
  une requête sortante directe sur une URL fournie par le client.
- **Test** : revue de code confirmant qu'aucun `fetch`/requête HTTP sortante
  n'est déclenché à partir de `sharedUrl` dans la route ou le worker de ce
  lot. `download-image-securely.test.ts` existant reste la référence pour
  le jour où cette surface s'ouvrira. *(Nouveau — mitigation par absence de
  surface, pas par filtrage)*

## 13. Fuite dans les logs

- **Mitigation** : jamais l'URL signée complète, le contenu binaire, ou
  une image en base64 dans les logs — déjà la règle pour
  `download-image-securely.ts` ; étendue explicitement au logger workers
  (`apps/workers/src/logger.ts`, pino) via une configuration `redact` pour
  les champs `imageReferences`/`sharedUrl`/`storageRef` du job
  `analysis.process`.
- **Test** : test worker capturant les logs émis et vérifiant l'absence de
  ces champs en clair. *(Nouveau)*

## 14. Cache partagé mélangeant deux produits différents

- **Mitigation** : la clé de cache produit (`compute-key.ts`) intègre déjà
  provider/modèle/versions de prompt/schéma/extracteur + fingerprint de
  contenu — un produit différent produit structurellement une clé
  différente ; aucune identité utilisateur n'entre dans la clé, donc
  aucun mélange possible entre utilisateurs pour un même produit (c'est le
  comportement recherché du cache partagé), et aucun mélange possible
  entre produits différents (fingerprint distinct).
- **Test** : tests existants de `compute-key.test.ts`/`memory-cache.test.ts`
  couvrent déjà la distinction par fingerprint. *(Existant)*

## 15. Utilisateur tentant d'accéder à l'analyse d'un autre

- **Mitigation** : RLS sur `analysis_requests` (`auth.uid() = user_id`,
  migration 0012) + filtre défensif côté route handler même quand la
  connexion utilise le service role.
- **Test** : voir point 6 — `GET` sur l'id d'un autre utilisateur → `404`.
  *(Nouveau)*

## 16. Données restantes après suppression du compte

- **Mitigation** : job de purge en cascade sur `analysis_requests` +
  objets Storage sous le préfixe utilisateur, même politique que
  `purge_expired_ai_cache()` existant pour le cache IA (migration 0011) —
  fonction équivalente ajoutée en migration 0012, déclenchée à la
  suppression de compte.
- **Test** : test migration/RPC vérifiant qu'aucune ligne
  `analysis_requests` ni objet Storage ne subsiste après appel de la
  fonction de purge pour un utilisateur donné. *(Nouveau)*
