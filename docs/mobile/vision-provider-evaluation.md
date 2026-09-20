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

## Statut au moment de la rédaction (2026-09-15)

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

## Mise à jour 2026-09-20 — OpenAI comme alternative déblocante

**Changement de contrainte, explicite, venant de Romain** : "ne bloque
plus le projet sur Groq... provider de vision alternatif déjà accessible
ou plus simple à configurer" — ceci assouplit, pour ce déblocage précis,
la contrainte "Budget 0 CHF non négociable" qui avait fait choisir Groq
ci-dessus. Ce n'est pas une annulation de cette contrainte pour le
produit en général, seulement pour sortir du blocage Groq actuel
(`GROQ_API_KEY` : aucune clé disponible localement, création de compte
hors périmètre agent — voir l'issue GitHub `AI-COORDINATION`).

### Audit : OpenAI est déjà entièrement câblé, zéro diff de code requis

- [`packages/ai/src/provider/openai.ts`](../../packages/ai/src/provider/openai.ts)
  implémente `AIProvider` à l'identique de `groq.ts` (même infra
  `fetchWithRetry`/`ProviderError`, mêmes champs `messages`/
  `image_url`/`response_format: json_object`) — déjà présent, déjà testé
  (4 tests dans
  [`__tests__/openai.test.ts`](../../packages/ai/src/provider/__tests__/openai.test.ts),
  dont un qui vérifie explicitement que les images sont bien envoyées en
  `image_url` et un qui vérifie que la clé API n'est jamais journalisée).
- [`apps/web/src/lib/tcg-ai-provider-config.ts`](../../apps/web/src/lib/tcg-ai-provider-config.ts)
  sait déjà construire un provider `openai` via `AI_PROVIDER=openai` +
  `OPENAI_API_KEY` (branche déjà présente, jamais touchée ici) — le choix
  du provider est une pure question de configuration par environnement,
  jamais de code.
- Le contrat de sortie (`AIProvider.extract()` -> `{ raw, usage }`,
  ensuite parsé par le même schéma Zod `rawTcgCardProviderResponseSchema`
  quel que soit le provider) est strictement inchangé — TCGdex, le
  pricing et l'historique ne savent même pas quel provider a produit le
  JSON brut. Aucune régression possible par construction.
- Seul écart réel trouvé : **`buildTcgAiExtractionConfig`/`buildProvider`
  n'avaient aucun test dédié** (déjà vrai pour Groq avant ce lot,
  indépendant du choix de provider) — comblé par
  [`apps/web/src/lib/__tests__/tcg-ai-provider-config.test.ts`](../../apps/web/src/lib/__tests__/tcg-ai-provider-config.test.ts)
  (7 tests : sélection par `AI_PROVIDER`, dégradation gracieuse clé
  absente, modèle par défaut vs `AI_MODEL` fourni, non-régression Groq,
  provider inconnu -> `undefined`, `dailyBudgetUsd` jamais `undefined`/`NaN`).

### Trouvaille : une clé OpenAI réelle existe déjà en local (non vérifiée en vie)

`.env.local` (racine du repo, gitignoré, jamais commité) contient déjà,
sous un commentaire "Clé réelle fournie le 2026-07-26" (Lot 5) :
`AI_PROVIDER=openai`, `OPENAI_API_KEY=<réelle>`, `AI_MODEL=gpt-4o-mini`,
`AI_DAILY_BUDGET_USD=2.00` — valeurs confirmées présentes par longueur/
égalité programmatique uniquement, **jamais lues ni affichées** dans
aucune session agent. Cette clé n'est PAS scopée à Vercel Preview
aujourd'hui (seule `apps/web/.env.local`, chargée par `next dev` en
local, la voit).

**Réserve honnête** : peu après cette date (voir le commit historique
"feat(ai): add Anthropic provider", ~1er août 2026 : *"Motivation: OpenAI
billing currently blocked"*), le pipeline était passé sur Anthropic à
cause d'un souci de facturation OpenAI. Cette clé du 26 juillet est donc
**potentiellement obsolète/bloquée** — sa validité actuelle n'est pas
vérifiée ici (aucun appel réseau réel effectué, conformément à la règle
"jamais d'appel IA payant sans validation explicite"). À confirmer par
Romain avant de s'appuyer dessus, ou à remplacer par une clé fraîche si
elle s'avère bloquée.

### Chemin le plus court restant

Aucun code à écrire. La seule action humaine : reporter ces 3 valeurs
(déjà connues, déjà dans `.env.local` local) dans Vercel → `dealradar-web`
→ Environment Variables → scope Preview : `AI_PROVIDER`, `OPENAI_API_KEY`,
`AI_MODEL` (`AI_DAILY_BUDGET_USD` optionnel, déjà à 2.00 en local) — plus
`SUPABASE_SERVICE_ROLE_KEY` scopée à Preview (requis par
`createServiceRoleClient()`, indépendant du choix de provider — voir
l'issue GitHub `AI-COORDINATION` pour le détail). Voir ce même doc, section
Groq ci-dessus, si cette clé OpenAI s'avère effectivement bloquée et que
Groq reste finalement la voie retenue une fois une clé Groq disponible.
