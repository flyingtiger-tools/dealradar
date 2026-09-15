# Provider vision IA & infra serverless TCG — évaluation (2026-09-15)

Doc opérationnelle (LOT "journée autonome, photo → identification →
prix"). Documente les décisions des Priorités 2/3/7 du lot : quel provider
IA vision, quelle infra serverless, pourquoi — avec les sources exactes,
pas des notes anciennes. Référencée depuis
[`capabilities.ts`](../../packages/ai/src/provider/capabilities.ts) et
[`.env.example`](../../.env.example).

## Provider vision IA (Priorité 3)

### Contrainte

Budget 0 CHF non négociable (Priorité 17) : le provider doit avoir un
palier réellement gratuit, sans carte bancaire, et ne jamais facturer en
dépassement (rejet propre, jamais une facture).

### Candidats évalués

| Provider | Palier gratuit | Vision | JSON mode | Verdict |
| --- | --- | --- | --- | --- |
| **Groq** (`qwen/qwen3.6-27b`) | Oui, "Developer"/sans carte, confirmé via [`console.groq.com/docs/rate-limits`](https://console.groq.com/docs/rate-limits) : 30 req/min, 1000 req/jour, 8K TPM, 200K TPD pour ce modèle | Oui — jusqu'à 5 images/requête, 20 Mo max/image ([`console.groq.com/docs/vision`](https://console.groq.com/docs/vision)) | Oui | **Choisi** |
| OpenRouter (modèles gratuits) | Oui pour une poignée de modèles marqués `:free`, mais quotas bas et variables par modèle, capacité vision incertaine selon le modèle du jour | Variable | Variable | Rejeté — trop instable pour un chemin production même interne |
| Gemini (palier gratuit) | Oui côté Google AI Studio | Oui | Oui | Rejeté — pas nécessaire d'ajouter un 5e provider : `packages/ai` a déjà 4 factories (openai/claude/groq/openrouter), aucune pour Gemini ; l'ajouter aurait demandé du code nouveau alors que Groq ne demandait aucun changement (Priorité 6) |

### Pourquoi Groq précisément, et zéro changement de code

[`packages/ai/src/provider/groq.ts`](../../packages/ai/src/provider/groq.ts)
envoyait déjà les images en `content: [...{type:"image_url", image_url:{url}}]`
et `response_format: {type:"json_object"}`, sans liste de modèles codée en
dur — accepte n'importe quel `model: string` fourni par l'appelant. Le
choix de `qwen/qwen3.6-27b` comme modèle par défaut n'a donc demandé que
deux entrées de table (`capabilities.ts`, `cost-table.ts`) et une valeur
d'environnement, jamais une nouvelle factory.

**Note de recherche** : une première recherche web (agrégateurs, blogs)
suggérait "Llama 4 Scout" comme modèle vision Groq. Une lecture directe de
`console.groq.com/docs/vision` (source officielle) a montré que les
modèles vision de production actuels sont `qwen/qwen3.6-27b` et
`qwen/qwen3.8-27b` — les notes d'agrégateurs étaient obsolètes. Toujours
vérifier la doc officielle directement, jamais un résumé tiers, avant de
figer un choix de modèle (leçon déjà appliquée dans ce lot, à réappliquer
la prochaine fois que ce choix doit être revu).

### Coût réel

`packages/ai/src/observability/cost-table.ts` déclare
`inputPerMTokUsd: 0` / `outputPerMTokUsd: 0` pour cette entrée — un fait
documenté (palier gratuit Groq = aucune facturation au token, seulement un
rejet HTTP 429 en cas de dépassement de quota), pas une approximation.

## Infra serverless (Priorités 2 et 7)

### Contrainte

Railway (`apps/workers`) est hors service (essai expiré) et ne doit
**jamais** être payé. Le scan carte doit fonctionner sans lui.

### Options évaluées

| Option | Verdict |
| --- | --- |
| **Vercel serverless** (`apps/web`, Next.js déjà déployé dessus) | **Choisi** — aucune nouvelle plateforme à intégrer, secrets déjà gérés via `apps/web/src/env.ts`, `pnpm build` existant produit déjà les routes API |
| Supabase Edge Function | Rejeté — aurait demandé une nouvelle chaîne de déploiement (Deno, pas Node/TS comme le reste du repo) pour un bénéfice non démontré ; `apps/web` était déjà le choix par défaut le plus simple |
| Rester sur Railway (payant) | Explicitement interdit (Priorité 2/17) |

### Limite de durée (`maxDuration`)

`apps/web/src/app/api/internal/tcg/analyze/route.ts` déclare
`export const maxDuration = 30;` — volontairement conservateur : les
sources consultées sur la limite réelle du plan Hobby Vercel pour une
route serverless (Node runtime, pas Edge) étaient contradictoires (10s vs
60s selon la source). 30s documente honnêtement cette incertitude plutôt
que de deviner ; à vérifier empiriquement lors du premier vrai appel live
(latence Groq + résolution catalogue + pricing, tout inclus dans une seule
invocation synchrone).

## Dégradation gracieuse du pricing (bug trouvé en cours de route)

`orchestratePokemonPipeline` exigeait un connecteur JustTCG non-optionnel
— en l'absence de `JUSTTCG_API_KEY`, **tout** le pipeline (y compris
l'identification gratuite, sans lien avec JustTCG) devenait indisponible.
Corrigé via
[`createNoopPricingConnector`](../../packages/connectors/src/pricing/noop/connector.ts)
(`lookup() → []` toujours, jamais une erreur) — appliqué à la fois dans
`apps/web/src/lib/tcg-connector-config.ts` (nouveau) et
`apps/workers/src/ingestion/tcg-connector-config.ts` (existant). Prouvé en
direct (script jetable, jamais committé) : TCGdex seul (aucune clé,
aucune IA) identifie et chiffre "Pikachu / Base Set / 58" avec un prix
Cardmarket réel (9.63 EUR, mise à jour du jour) — voir Priorité 10
("identified_no_price ne doit jamais être un échec total").

## Statut au moment de la rédaction

- Code : complet, testé (`pnpm lint && pnpm typecheck && pnpm test && pnpm build` verts).
- **Appel live réel non encore effectué** : nécessite `GROQ_API_KEY` posée
  côté Vercel (ni cette session ni aucune session précédente n'a
  matérialisé de valeur de clé — aucune clé Groq n'existe dans aucun
  `.env*` du repo). Cette clé s'obtient gratuitement sur
  `console.groq.com` (compte, sans carte bancaire) — action qui doit être
  faite par l'utilisateur, jamais par un agent (création de compte/gestion
  d'identifiants hors périmètre). Une fois posée (Vercel : `GROQ_API_KEY`,
  `AI_PROVIDER=groq`, `AI_MODEL=qwen/qwen3.6-27b` — ce dernier déjà la
  valeur par défaut si omis), le test live (3 appels max, Priorité 4) peut
  être effectué dans une session future.
