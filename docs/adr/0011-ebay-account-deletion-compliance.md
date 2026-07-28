# ADR 0011 — Conformité eBay Marketplace Account Deletion

**Statut** : accepté, durci (round 4) · **Date** : 2026-07-28

## Contexte

Le connecteur eBay (ADR 0008) est intégralement construit et testé (OAuth
client credentials, client HTTP avec retry/backoff, `search()`/`getItem()`
Browse API, normalisation) mais n'a jamais tourné contre un compte eBay
réel : `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` sont restés vides pendant tout
le Lot 4.

Avant d'activer un **keyset Production** sur developer.ebay.com, le
programme développeur eBay exige que **toute** application (y compris en
OAuth *client credentials*, sans flux utilisateur, comme DealRadar)
enregistre un endpoint conforme au programme **Marketplace Account
Deletion / Closure Notifications** — exigence indépendante du code du
connecteur lui-même.

## Audit exhaustif des données persistées

Grep exhaustif sur toutes les migrations (`seller`, `username`, `user_id`,
`userId`, `eias`) + lecture du pipeline d'ingestion réel
(`persist-listing.ts`, `redact.ts`, `normalize.ts`) — pas une supposition :

| Table | Colonne | Donnée identifiant un compte eBay ? |
|---|---|---|
| `public.listings` | `raw_payload` (jsonb) | **Oui** — `raw_payload->>'sellerUsername'`, le nom d'utilisateur du vendeur eBay (voir `packages/connectors/src/ebay/redact.ts`, liste blanche explicite) |
| `public.listings` | `seller_external_id` | Colonne dédiée existante, mais **toujours `null` pour eBay aujourd'hui** (voir audit Browse API ci-dessous) |
| `public.listing_media` | — | Aucune (URL image, position, OCR/vision — rien de vendeur) |
| `public.price_observations` | — | Aucune (prix/devise/statut uniquement) |
| `public.market_aggregates` | — | Aucune (agrégats statistiques) |
| `public.ai_extraction_cache` | — | Aucune (cache produit keyé par fingerprint image/texte, volontairement sans identité — ADR 0009) |
| `public.ai_usage_log` | `listing_id` | FK vers `listings`, aucune duplication de donnée vendeur |
| `public.analysis_requests` (0012) | `user_id` | Référence `auth.users` — un compte **DealRadar**, sans rapport avec un compte eBay |
| `public.watchlists`/`alerts`/`portfolio_positions`/`notifications`/`subscriptions` | `user_id`/`seller_id` | Toutes référencent `public.profiles`/`auth.users` — comptes **DealRadar**, jamais eBay |

**Conclusion de l'audit** : la seule donnée permettant d'identifier un
compte eBay que DealRadar persiste est le **nom d'utilisateur du vendeur**,
dans `listings.raw_payload->>'sellerUsername'`.

## Audit de l'API Browse eBay — ce qu'elle expose réellement (pas supposé)

Vérifié contre la documentation officielle eBay des types `Seller`
(item_summary) et `SellerDetail` (item) de la Browse API
(`developer.ebay.com/api-docs/buy/browse/types/gct:Seller` et
`gct:SellerDetail`) :

| Champ | Type | Immuable ? |
|---|---|---|
| `username` | string | **Non** — un utilisateur eBay peut changer son nom d'utilisateur |
| `feedbackScore` | integer | N/A — statistique, pas un identifiant |
| `feedbackPercentage` | string | N/A — statistique, pas un identifiant |
| `sellerAccountType` | enum (`BUSINESS`/`INDIVIDUAL`) | N/A — catégorie, pas un identifiant |
| `sellerLegalInfo` | objet (info légale entreprise) | Non capturé par notre connecteur (`raw-types.ts` ne le type pas) |

**Aucun identifiant vendeur immuable n'existe dans ces deux types** —
`username` est la seule donnée d'identité disponible via cette API, et elle
est mutable. C'est la raison structurelle pour laquelle
`listings.seller_external_id` reste toujours `null` pour eBay aujourd'hui :
non par choix d'implémentation, mais parce que l'API que nous consommons ne
fournit rien à y mettre (`normalize.ts` fixe `seller.externalId: null`
explicitement, en connaissance de cause).

### Conséquence sur la corrélation d'une notification de suppression — ne rien supposer

La notification `MARKETPLACE_ACCOUNT_DELETION` peut fournir `username`,
`userId` et/ou `eiasToken` (identifiants internes eBay). Seul `username`
peut être comparé à une donnée que nous possédons — `userId`/`eiasToken` ne
correspondent à rien de stocké dans ce schéma. Deux limites, jamais à
occulter :

1. **Notification sans `username`** : rien à corréler, aucune recherche
   n'est déclenchée. Journalisé avec le code neutre
   `DELETION_SUBJECT_NOT_CORRELATED` — **aucun identifiant, même partiel,
   n'apparaît dans ce log**.
2. **Notification avec `username`, mais vendeur ayant changé de nom
   d'utilisateur** entre la collecte de l'annonce et la suppression de son
   compte : la corrélation échoue silencieusement (0 résultat). Aucun moyen
   de détecter ce cas avec les données actuellement disponibles — limite
   assumée, pas contournable sans un identifiant immuable qu'eBay ne
   fournit pas à ce niveau d'API aujourd'hui.

**En conséquence, cette implémentation ne doit jamais être présentée comme
une suppression universellement complète.** Elle est complète et vérifiée
pour le sous-ensemble des notifications **corrélables par nom
d'utilisateur** ; elle ne peut rien garantir au-delà (notifications sans
`username`, ou `username` déjà changé côté eBay).

### Migration future proposée, **non créée, non appliquée**

Si une version future de l'API Browse (ou un accès partenaire eBay) expose
un identifiant vendeur immuable, `seller_external_id` est déjà prêt à le
recevoir sans changement de schéma — aucune action nécessaire tant que
cette donnée n'existe pas côté eBay. Aucune migration n'est proposée pour
anticiper un champ qui n'existe pas encore.

## Politique de suppression/anonymisation — implémentée, pas seulement préparée

`apps/web/src/app/api/ebay/account-deletion/data-deletion.ts` —
`anonymizeEbaySellerData(supabase, { username, userId })` :

- Retourne `{ correlationAttempted: false, listingsAnonymized: 0 }`
  immédiatement si ni `username` ni `userId` ne sont fournis — **aucune
  recherche déclenchée**, distingue explicitement « rien à corréler » de
  « recherché, mais rien trouvé ».
- Sinon, recherche les `listings` où `raw_payload->>'sellerUsername' =
  username` et/ou `seller_external_id = userId`, retourne
  `correlationAttempted: true` (que 0 ou N lignes aient été trouvées).
- Retire la clé `sellerUsername` du JSONB (jamais l'annonce entière : c'est
  une donnée de marché publique légitime, seule l'identité du vendeur est
  personnelle) et met `seller_external_id` à `null`.
- **Idempotente par construction** : une fois la clé retirée, la même
  recherche ne retrouve plus la ligne lors d'une ré-exécution — aucune
  double écriture, aucune erreur. Testé explicitement (ré-exécution avec
  les mêmes identifiants → `listingsAnonymized: 0` la seconde fois).
- **Aucune migration nécessaire pour cette implémentation** : le retrait de
  clé JSONB est fait côté application (lecture, retrait, écriture), pas via
  un opérateur SQL dédié.

### Migration optionnelle proposée, **non appliquée** (efficacité à grande échelle)

```sql
-- PROPOSÉ, NON APPLIQUÉ — nécessite l'accord explicite de l'opérateur.
create index if not exists idx_listings_raw_payload_seller
  on public.listings using gin ((raw_payload -> 'sellerUsername'));

create or replace function public.anonymize_ebay_seller(
  p_username text, p_user_id text
) returns int language sql as $$
  with updated as (
    update public.listings
    set raw_payload = raw_payload - 'sellerUsername', seller_external_id = null
    where (p_username is not null and raw_payload->>'sellerUsername' = p_username)
       or (p_user_id is not null and seller_external_id = p_user_id)
    returning 1
  )
  select count(*)::int from updated;
$$;
```

Non bloquant : l'implémentation applicative actuelle fonctionne sans cette
migration, juste avec un coût de scan plus élevé à très grande échelle.

## Notifications dupliquées — déduplication en mémoire, jamais la garantie de sûreté

`dedup-store.ts` : `Map<notificationId, timestamp>` avec TTL 24h. Réduit le
travail redondant quand eBay retente une notification déjà acquittée.
**C'est l'idempotence de `anonymizeEbaySellerData` qui est la véritable
garantie de sûreté ici, pas la déduplication** — celle-ci n'est qu'une
optimisation best-effort qui évite un travail redondant.

`NotificationDedupStore` expose délibérément deux opérations distinctes
plutôt qu'une seule (round 4) : `hasSeen(id)` (contrôle pur, sans effet de
bord) et `markSeen(id)` (ne doit être appelé **qu'après un traitement
réussi confirmé**). Une version antérieure enregistrait l'ID dès réception
de la notification, avant toute vérification de signature ou tentative
d'anonymisation ; deux défauts en découlaient, corrigés ici :

1. **Un échec bloquait silencieusement les nouvelles tentatives** : si
   l'anonymisation échouait (erreur Supabase, timeout) après que l'ID avait
   déjà été marqué comme « vu », une notification légitimement retentée par
   eBay était à tort traitée comme un doublon et jamais réellement
   anonymisée.
2. **Le store était empoisonnable par un appelant non authentifié** : marquer
   l'ID avant la vérification de signature permettait à quiconque connaissant
   (ou devinant) un `notificationId` de le faire enregistrer comme « vu »
   avec une signature invalide, faisant ensuite ignorer à tort la
   notification légitime portant le même identifiant.

Avec `hasSeen`/`markSeen` séparés, le contrôle de doublon n'a lieu
**qu'après** vérification de signature (voir section POST), et le
marquage **qu'après** succès confirmé de l'anonymisation — un échec ne
marque jamais rien, une nouvelle tentative peut donc réussir normalement.

**Limite assumée, toujours documentée** : store en mémoire, par instance de
processus. Sur un déploiement serverless multi-instance, deux invocations
concurrentes sur des instances différentes ne partagent pas ce cache — une
notification peut donc être vue plus d'une fois à travers des instances
différentes. Sans conséquence dommageable **uniquement parce que**
`anonymizeEbaySellerData` est elle-même idempotente. Une table Postgres
partagée éliminerait la limite d'instance :

```sql
-- PROPOSÉ, NON APPLIQUÉ.
create table if not exists public.ebay_notification_dedup (
  notification_id text primary key,
  received_at timestamptz not null default now()
);
-- purge périodique recommandée (ex. 30 jours), non planifiée automatiquement.
```

## Vérification de signature `X-EBAY-SIGNATURE` — obligatoire dans tout environnement déployé

Confirmé en lisant le **SDK de référence officiel eBay**
(`github.com/eBay/event-notification-php-sdk`, Apache-2.0,
`lib/validator.php` + `lib/client.php`), pas deviné :

1. L'en-tête est du JSON encodé en base64 : `{ kid, signature }`.
2. Clé publique récupérée via
   `GET {host}/commerce/notification/v1/public_key/{kid}` avec un Bearer
   token OAuth *application* (même client credentials que la Browse API),
   réponse `{ key: "<PEM ou base64 brut>" }`. **Cache ~1h** (recommandation
   eBay), testé explicitement avec horloge simulée (avance de 1h + 1s →
   re-récupération confirmée).
3. Vérification avec un digest **SHA-1** (`OPENSSL_ALGO_SHA1` confirmé dans
   le SDK de référence — pas SHA-256, malgré ce qu'on pourrait attendre
   d'un schéma récent).

**Divergence assumée par rapport au SDK de référence** : celui-ci
re-sérialise le message déjà parsé (`json_encode($message)`) avant de
vérifier — risque de non-correspondance octet-pour-octet selon l'ordre des
clés/l'espacement du ré-encodage. Notre implémentation vérifie contre les
**octets bruts exacts du corps de la requête**, capturés avant tout
parsing — plus robuste, sans dépendance à un ré-encodage fidèle.

### ⚠️ Écart à l'ADR 0008 — accepté et justifié, uniquement pour cet usage

L'ADR 0008 établit que les identifiants eBay ne doivent **jamais** être
lisibles par `apps/web`. La récupération de la clé publique de signature
exige pourtant un token OAuth *application* eBay — le même couple
`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` que la Browse API, eBay n'émettant
qu'un seul couple client credentials par application (aucune portée
réduite disponible pour cet usage seul).

**Décision : cet écart est accepté, mais strictement borné aux conditions
suivantes** — s'il devait être étendu au-delà, il faudrait une nouvelle
revue :

- **Usage unique et read-only** : ces identifiants ne servent, côté
  `apps/web`, qu'à obtenir un Bearer token pour un seul appel
  `GET .../public_key/{kid}` — jamais un appel Browse API, jamais une
  écriture sur le marché eBay, jamais un flux utilisateur.
- **Aucune sortie de données** : l'appel est strictement sortant
  (apps/web → eBay) ; aucune donnée utilisateur ou de marché n'est envoyée
  à eBay dans cet appel au-delà des identifiants d'application eux-mêmes.
- **Isolation stricte serveur** : ces variables restent des variables
  d'environnement serveur classiques (jamais `NEXT_PUBLIC_*`), jamais
  incluses dans une réponse HTTP, jamais transmises à `apps/mobile` ni au
  navigateur, jamais journalisées (vérifié par test dédié couvrant
  spécifiquement `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`, en plus de
  `username`/`userId`/`eiasToken`).
- **Nécessité fonctionnelle réelle, pas une commodité** : sans ce token, la
  signature ne peut structurellement pas être vérifiée (eBay ne propose
  aucune alternative — pas de clé publique statique, pas d'endpoint anonyme
  pour ce cas d'usage) ; refuser l'écart reviendrait à renoncer à toute
  vérification de signature en production, ce qui est inacceptable pour un
  endpoint de conformité qui déclenche une anonymisation de données.

**Conséquence directe sur le comportement runtime (voir section POST
ci-dessous), révisée au round 4** : puisque l'écart est accepté, la
vérification est **obligatoire dans TOUT environnement déployé**, pas
seulement en production. La version round 3 désactivait la vérification
hors production quand les identifiants étaient absents (avertissement
journalisé, traitement poursuivi sans vérification) — ce comportement est
**supprimé** : un endpoint de conformité qui anonymise des données ne doit
jamais avoir de mode « non vérifié » atteignable en dehors des tests
unitaires, sandbox inclus. `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` absents,
quel que soit `EBAY_ENVIRONMENT` (sandbox ou production) → échec fermé
(`MISCONFIGURED`, HTTP 500), aucun traitement.

`EBAY_ENVIRONMENT` ne sert donc plus qu'à sélectionner l'hôte API eBay
(sandbox vs production) pour la récupération du token OAuth/de la clé
publique — ce n'est **plus un interrupteur de sécurité**. Le seul moyen de
contourner la vérification de signature est l'injection explicite d'un
`verifySignature` mocké via `AccountDeletionPostDeps`, réservée aux tests
unitaires ; `defaultDeps` (utilisé par `POST` en runtime réel) ne l'utilise
jamais.

### Statut réel — à ne pas confondre avec « vérifié en conditions réelles »

Implémentation fidèle à la documentation/au SDK officiels, couverte par des
tests unitaires avec une paire de clés RSA **synthétique** générée
localement (signature valide, corps altéré détecté, en-tête absent/
malformé, échec de récupération de clé, mise en cache, expiration du cache
après ~1h). **Jamais exercée contre une signature réelle émise par
l'infrastructure eBay** — aucun identifiant réel disponible pour le faire.

## Emplacement : Route Handler Next.js, pas de fonction Supabase Edge

`apps/web/src/app/api/ebay/account-deletion/route.ts` — cohérent avec la
convention déjà en place (`apps/web/src/app/api/v1/analyses/*`), aucune
nouvelle chaîne de déploiement à introduire.

## GET — défi de vérification

`GET <url>?challenge_code=<code>` → `{"challengeResponse": "<hash>"}`,
`Content-Type: application/json`, où `hash` =
`SHA256(challengeCode + verificationToken + endpoint)` en hex minuscule,
concaténation directe sans séparateur, dans cet ordre exact — confirmé
identique dans `generateChallengeResponse()` du SDK de référence eBay.

`EBAY_VERIFICATION_TOKEN` et `EBAY_ACCOUNT_DELETION_ENDPOINT_URL` sont
tous deux obligatoires (erreur `MISCONFIGURED`, HTTP 500, sinon) — pas de
repli automatique de l'URL depuis les en-têtes de la requête.

## POST — traitement réel de la notification, comportement HTTP exact (round 4)

**Principe directeur, révisé au round 4** : un `200` ne doit jamais être
optimiste. Il n'est renvoyé que lorsque le traitement a réellement réussi,
ou lorsqu'il n'y avait légitimement rien à faire (doublon, sujet non
corrélable, topic/schéma non pris en charge). Une erreur interne ou
temporaire pendant l'anonymisation retourne désormais un statut d'erreur
explicite — la version round 3 acquittait tout par 200, y compris un échec
d'anonymisation, ce qui masquait la défaillance à l'opérateur et (combiné
à l'ancien dedup, voir ci-dessus) empêchait silencieusement toute nouvelle
tentative de réparer la situation.

Ordre exact (la signature gate désormais tout le reste, y compris le
`JSON.parse` — voir justification ci-dessous) :

1. **Garde de configuration, avant toute lecture du corps** :
   `EBAY_CLIENT_ID` ou `EBAY_CLIENT_SECRET` absent, **quel que soit
   `EBAY_ENVIRONMENT`** → **500 `MISCONFIGURED`**, aucun traitement.
2. Lecture du corps brut, vérification `X-EBAY-SIGNATURE` contre les
   **octets bruts exacts, avant tout `JSON.parse`**. En-tête absent ou
   signature invalide → **412 `SIGNATURE_INVALID`**, **aucune
   anonymisation, aucun `JSON.parse` tenté** (comportement conforme au
   comportement documenté des SDK eBay — `PRECONDITION_FAILED` dans le SDK
   de référence). Vérifier la signature avant même de parser le JSON évite
   d'interpréter ou de journaliser quoi que ce soit venant d'un appelant
   non authentifié.
3. `JSON.parse` du corps (signature déjà validée à ce stade) : échec
   syntaxique → **400 `INVALID_JSON`**, aucun traitement.
4. Validation Zod stricte (`notification-schema.ts` — topic et version de
   schéma vérifiés via `z.literal`) : échec → **200 `{acknowledged:true}`**
   délibéré, aucun traitement, avertissement journalisé (chemins/messages
   Zod uniquement, jamais le contenu). Justification du 200 ici et non un
   4xx : un topic/schéma inattendu n'est ni une erreur temporaire ni
   quelque chose qu'une nouvelle tentative résoudrait (mauvais routage ou
   version de schéma dépréciée côté eBay) — un 200 évite des retries
   indéfinis pour une notification que cet endpoint ne traitera jamais.
5. Déduplication par `notificationId` (`hasSeen`, best-effort, voir
   ci-dessus) — **après** la vérification de signature (jamais avant, voir
   justification anti-empoisonnement ci-dessus) : doublon détecté → **200**
   acquitté, aucun retraitement.
6. Anonymisation réelle (`anonymizeEbaySellerData`) :
   - **Succès** (y compris « déjà anonymisé », `listingsAnonymized: 0`) :
     `markSeen(notificationId)` appelé, puis **200
     `{acknowledged:true}`**. Si `correlationAttempted` est `false` (aucun
     `username`/`userId` fourni), code neutre `DELETION_SUBJECT_NOT_CORRELATED`
     journalisé, **aucun identifiant** dans ce log.
   - **Échec** (exception : erreur Supabase, timeout, indisponibilité
     réseau) : **rien n'est marqué** dans le dedup store, l'erreur est
     journalisée (message seul, jamais `username`/`userId`/`eiasToken`),
     et la réponse est **503 `PROCESSING_FAILED`** — jamais un 200. eBay
     retentera, et l'anonymisation étant idempotente, la nouvelle
     tentative est sûre et peut réussir normalement.

Aucun `username`/`userId`/`eiasToken`/`EBAY_CLIENT_ID`/
`EBAY_CLIENT_SECRET`/`kid`/signature n'apparaît jamais dans un log — vérifié
par tests dédiés, y compris sur le chemin d'erreur 503.

### Matrice statut HTTP → situation

| Situation | Statut | Traitement exécuté ? |
|---|---|---|
| `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` absent (tout environnement) | 500 `MISCONFIGURED` | Non |
| En-tête `X-EBAY-SIGNATURE` absent | 412 `SIGNATURE_INVALID` | Non |
| Signature invalide | 412 `SIGNATURE_INVALID` | Non |
| JSON syntaxiquement invalide (signature valide) | 400 `INVALID_JSON` | Non |
| Topic/version de schéma non pris en charge | 200 `{acknowledged:true}` | Non (délibéré, voir justification) |
| Doublon (`notificationId` déjà marqué `hasSeen`) | 200 `{acknowledged:true}` | Non (déjà fait) |
| Sujet non corrélable (`username`/`userId` absents) | 200 `{acknowledged:true}` | Oui — `DELETION_SUBJECT_NOT_CORRELATED` |
| Anonymisation réussie (0 ou N lignes) | 200 `{acknowledged:true}` | Oui |
| Erreur interne/temporaire pendant l'anonymisation | 503 `PROCESSING_FAILED` | Tenté, non confirmé — dedup non marqué |

## Verification Token

Un premier token généré lors d'une session précédente a été affiché en
clair dans un rapport et doit être considéré comme **exposé** — il n'est
plus utilisé. Un nouveau token a été généré (64 caractères hexadécimaux,
`crypto.randomBytes(32)`), **jamais affiché en clair** dans ce document ni
dans aucun rapport — seulement masqué. Voir le rapport livré séparément
pour la forme masquée et la procédure de configuration.

## Procédure complète

1. Renseigner `EBAY_VERIFICATION_TOKEN` (voir rapport pour la valeur
   masquée — la valeur réelle doit être transmise hors bande, jamais
   recopiée depuis un document) et `EBAY_ACCOUNT_DELETION_ENDPOINT_URL`
   dans l'environnement serveur d'`apps/web` une fois déployé.
2. Renseigner `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`/`EBAY_ENVIRONMENT`
   côté `apps/web` — **obligatoire dès que `EBAY_ENVIRONMENT=production`**
   (voir « Écart ADR 0008 » ci-dessus) ; sans cela l'endpoint répond 500
   MISCONFIGURED et ne traite plus aucune notification en production.
3. Sur developer.ebay.com → **My Account** → **Application Keys** →
   **Notifications** (Marketplace Account Deletion) : renseigner l'URL
   exacte et le Verification Token.
4. eBay envoie immédiatement un `GET ?challenge_code=...` — la sauvegarde
   échoue côté eBay si la réponse ne correspond pas exactement.
5. Une fois validé, l'option d'activation d'un keyset **Production**
   devient disponible.
6. Activer le keyset Production, renseigner
   `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` (production) et
   `EBAY_ENVIRONMENT=production` dans l'environnement des workers **et**
   d'`apps/web`.

## Ce qui reste bloqué sans action de l'utilisateur

Aucune des étapes 1 à 6 ci-dessus n'a été exécutée dans ce lot (rien
déployé, aucune clé écrite dans le code). Le premier appel réel contre
l'API eBay Production reste impossible tant que ces étapes n'ont pas été
effectuées.

## Limites assumées

- Signature vérifiée selon la documentation officielle mais jamais testée
  contre une signature réelle émise par eBay.
- Suppression **complète uniquement pour les notifications corrélables par
  nom d'utilisateur** — jamais universelle : une notification sans
  `username`, ou avec un `username` qui a changé côté eBay depuis la
  collecte de l'annonce, ne peut pas être rattachée automatiquement (voir
  audit Browse API ci-dessus).
- Déduplication en mémoire : best-effort uniquement, jamais une garantie
  cross-instance en serverless — **la sûreté vient réellement de
  l'idempotence de l'anonymisation, pas de la déduplication** (migration
  proposée, non appliquée). `markSeen` n'a lieu qu'après succès confirmé,
  pour ne jamais bloquer une nouvelle tentative légitime après un échec.
- Anonymisation applicative (pas de fonction SQL dédiée) — fonctionnelle
  mais moins efficace à grande échelle qu'une fonction Postgres avec index
  GIN dédié (migration proposée, non appliquée).
- Aucun identifiant vendeur immuable disponible aujourd'hui via la Browse
  API — migration de stockage future proposée uniquement si eBay expose un
  tel champ (non créée, non appliquée).
