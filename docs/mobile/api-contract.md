# Contrat universel d'analyse — `/v1/analyses`

Un seul contrat pour web, Android, iPhone, extension de partage, alertes
e-mail futures, agents futurs. Voir ADR 0010 pour le raisonnement. Schémas
Zod sources de vérité : `packages/contracts/src/analysis-request.ts` et
`analysis-result.ts`.

## Authentification

`Authorization: Bearer <supabase_access_token>` sur toutes les routes.
Vérifié côté serveur par `apps/web/src/lib/supabase/route-auth.ts` via
`supabase.auth.getUser(token)` (clé anonyme + token utilisateur — jamais la
clé service role côté vérification d'identité). 401 structuré si absent ou
invalide.

## `POST /v1/analyses`

### Requête

```json
{
  "sourceType": "android_screen_capture",
  "sourcePlatform": "facebook_marketplace",
  "sharedUrl": null,
  "title": null,
  "description": null,
  "categorySlug": null,
  "purchasePrice": null,
  "currency": "CHF",
  "imageReferences": [],
  "consentVersion": "1",
  "clientRequestId": "a1b2c3d4-..."
}
```

`sourceType` (enum, `packages/contracts/src/analysis-request.ts`) :
`android_screen_capture` · `ios_share_extension` · `ios_screenshot_share` ·
`mobile_camera` · `image_upload` · `shared_url` · `email_alert` ·
`official_connector` · `manual_entry`.

Tous les champs sont validés par `analysisRequestSchema` (Zod). Champ
requis : `sourceType`, `consentVersion`, `clientRequestId`. Tout le reste
est optionnel — le pipeline (section « Résultat ») décide ce qui manque et
retourne `INSUFFICIENT_DATA` plutôt que d'inventer une valeur.

`categorySlug` mérite une précision : Intelligence Core (ADR 0007) ne
couvre que 5 catégories déclaratives (`lego`, `pokemon_tcg`, `apple`,
`gaming`, `photo`) — limite préexistante, pas introduite par ce lot. Sans
elle, l'extraction déterministe n'a pas de profil d'exigence à appliquer.
Si `categorySlug` est absent, le worker retourne `INSUFFICIENT_DATA` avec
un avertissement plutôt que de deviner. Le client est censé faire
confirmer la catégorie par l'utilisateur (section 12 du brief produit)
avant l'envoi, pas la déduire lui-même.

### Comportement serveur (`apps/web/src/app/api/v1/analyses/route.ts`)

1. Authentifie via `route-auth.ts`.
2. Valide le corps avec `analysisRequestSchema` → `400` structuré si échec.
3. Rate-limit via `check_and_increment_rate_limit` (RPC, migration 0012) →
   `429` avec `Retry-After` si dépassé.
4. Idempotence : `insert ... on conflict (user_id, client_request_id) do
   nothing returning *`. En cas de conflit, relit la ligne existante et
   retourne son statut actuel au lieu de créer un doublon — **aucun second
   appel IA n'est jamais déclenché par une réémission réseau**.
5. Si `imageReferences` est fourni : vérifie que chaque URL pointe bien
   dans le bucket privé `analysis-uploads`, sous le préfixe de
   l'utilisateur authentifié (`<user_id>/...`) — jamais une URL externe
   arbitraire à ce stade. Les images sont déjà uploadées par le client
   mobile directement vers Storage (RLS propriétaire, migration 0012)
   avant l'appel à cette route ; la route ne fait que référencer ce qui
   existe déjà, elle ne télécharge rien.
6. Enqueue le job `analysis.process` (`enqueueJob()`,
   `packages/core/src/queues.ts`).
7. Répond `202 { id, status: "pending" }`.

Le téléchargement effectif d'une image (pour la passer au provider IA) et
sa validation MIME/octets magiques (`packages/ai/src/image-policy/*`) n'ont
lieu que plus tard, côté worker, et seulement si l'extraction déterministe
s'avère insuffisante — même ordre paresseux que le pipeline eBay existant
(ADR 0009), jamais dans la route elle-même. `sharedUrl` est stockée comme
métadonnée dans ce lot mais **n'est jamais récupérée par le serveur** :
aucun scraping de marketplace n'est introduit par ce lot.

### Réponse (202)

```json
{ "id": "uuid", "status": "pending" }
```

## `GET /v1/analyses/:id`

Polling du statut/résultat. Scope à l'utilisateur authentifié (RLS +
filtre défensif `user_id` côté requête, même si la connexion utilise le
service role côté serveur).

```json
{
  "id": "uuid",
  "status": "completed",
  "result": {
    "product": { "name": "...", "category": "...", "modelOrReference": "..." },
    "conditionEstimated": "used_good",
    "priceDetected": { "amount": 25, "currency": "CHF" },
    "marketValueEstimate": { "amount": 40, "currency": "CHF", "provenance": "sold_transaction" },
    "resaleRangeConservative": { "low": 30, "high": 45, "currency": "CHF" },
    "grossMargin": 15,
    "estimatedFees": 3,
    "netMargin": 12,
    "confidenceScore": 62,
    "liquidityScore": 70,
    "dealScore": 55,
    "decision": "REVIEW",
    "warnings": [],
    "reasons": ["..."],
    "dataAvailability": { "soldTransactions": true, "marketGuide": false }
  }
}
```

`confidenceScore`/`liquidityScore`/`dealScore` sont sur l'échelle 0-100
native d'Intelligence Core (`computeConfidenceScore`/`computeLiquidityScore`/
`computeDealScore`, `packages/core/src/intelligence/scores.ts`) — jamais
renormalisés en 0-1. Dans ce lot, `marketValueEstimate.provenance` ne peut
jamais valoir `market_guide`/`retail_price`/`estimated_value` : la seule
source de marché branchée est le pool de comparables vendus déjà persisté
par l'ingestion eBay existante (`sold_transaction`), ou l'absence de donnée
(`unknown`/`null`). Ces trois valeurs restent dans l'enum pour un futur
connecteur/guide de prix, pas simulées aujourd'hui.

`status` : `pending` · `processing` · `completed` · `failed` ·
`insufficient_data`. `result` est `null` tant que `status` n'est pas
`completed`/`insufficient_data`. Le schéma `analysisResultSchema`
(`packages/contracts/src/analysis-result.ts`) est une enveloppe autour des
types déjà produits par Intelligence Core (`Decision`, `IntelligenceScores`,
`WhyPanelInput`/sortie — `packages/core/src/intelligence/types.ts`), pas un
nouveau moteur de décision.

`provenance` distingue toujours `sold_transaction` · `market_guide` ·
`active_listing` · `retail_price` · `estimated_value` · `unknown` — jamais
« dernières ventes » affiché si la source réelle est un guide de prix.

## Erreurs

Forme structurée commune :

```json
{ "error": { "code": "RATE_LIMITED", "message": "..." } }
```

Codes : `UNAUTHORIZED` (401) · `INVALID_REQUEST` (400, détail Zod) ·
`RATE_LIMITED` (429) · `PAYLOAD_TOO_LARGE` (413) · `UNSUPPORTED_IMAGE`
(422, MIME/domaine rejeté) · `NOT_FOUND` (404) · `INTERNAL` (500).

## Versionnement

Préfixe `/v1/` dans le chemin. Un changement non rétrocompatible du
schéma de requête ou de résultat introduit `/v2/` plutôt que de modifier
`/v1/` en place — aucun client mobile publié ne doit se briser
silencieusement suite à un déploiement backend.

## Hors périmètre de ce lot

Paiement, quotas premium réels (structure de quota préparée mais non
appliquée financièrement — voir brief section 14), webhook de notification
de fin d'analyse (le client fait du polling `GET` dans ce lot).
