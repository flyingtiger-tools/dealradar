# ADR 0009 — AI Extraction Engine V1

**Statut** : accepté · **Date** : 2026-07-26

## Contexte

Lot 4 a laissé une vraie limite ouverte : eBay ne fournit souvent pas des
attributs d'identification fiables (aspects bruts eBay non mappés à nos
clés de profil comme `setNumber`), et les images collectées par le
connecteur n'étaient même pas persistées. Résultat : beaucoup d'annonces
restent bloquées à `insufficient_data` faute d'**identification**, pas
faute de comparables. Ce lot construit le moteur d'extraction qui comble ce
trou.

## Limite explicite — ce que ce lot ne change pas

**Ce lot améliore l'identification des annonces. Il ne crée aucun
comparable vendu.** eBay standard (sans accès Marketplace Insights, cf. ADR
0008) ne fournit toujours aucune vente conclue. Une annonce eBay
correctement identifiée par ce moteur reste donc `INSUFFICIENT_DATA` en
sortie d'Intelligence Core tant qu'aucune source crédible de ventes
conclues n'est branchée. **Le succès de ce lot se mesure à la précision
d'identification (voir critères mesurables plus bas), jamais au nombre de
`BUY` produits.**

## Règle absolue

Le moteur d'extraction **n'exprime jamais de jugement de valeur**. Il ne
calcule ni score, ni estimation, ni recommandation d'achat/vente/attente.
Ces responsabilités restent exclusivement dans Intelligence Core (ADR
0007), inchangé par ce lot. Vérification :
- test statique (`prompts/__tests__/build-prompt.test.ts`) : toute mention
  d'un mot-clé de jugement dans le prompt système apparaît uniquement dans
  une phrase d'interdiction explicite, jamais une affirmation ;
- `grep -r "ebay\|marketplace" packages/ai/src` → vide (indépendance des
  marketplaces) ;
- `packages/ai` ne dépend que de `zod` et `@dealradar/contracts`.

## Architecture des paquets

- **`@dealradar/contracts`** (nouveau, périmètre strict) — `ItemCondition`
  et `CategorySlug` (et leurs schémas Zod), seule source de vérité pour ces
  deux contrats. `packages/core` ré-exporte (`CategoryProfileSlug` reste le
  nom historique utilisé partout ailleurs, aucun import existant cassé).
  Aucun autre contrat n'a été touché — refonte volontairement hors
  périmètre.
- **`packages/ai`** (@dealradar/ai) — moteur d'extraction, zéro dépendance
  marketplace. Réutilisable tel quel par un futur connecteur Ricardo,
  Cardmarket, Amazon, Facebook Marketplace, Galaxus, Vinted, Leboncoin, etc.
- **`packages/ingestion`** — intègre le moteur (`extract-listing.ts`),
  fournit les implémentations Supabase du cache et du budget
  (`ai-cache-supabase.ts`, `ai-budget-supabase.ts`) : `packages/ai` ne
  connaît jamais Postgres directement.
- **`apps/workers`** — construit le provider depuis l'environnement
  (`ai-provider-config.ts`), câblé dans `ingest-and-analyze.ts` entre
  `runIngestion` et `analyzeListing`.

```
eBay → Normalisation → Persistance (+ images) → Extraction (déterministe → IA si besoin)
     → Validation Zod → Intelligence Core → Décision (INSUFFICIENT_DATA tant
     qu'aucun comparable vendu n'existe)
```

## Déterministe d'abord, IA seulement si nécessaire

`parser/deterministic-extractor.ts` reconnaît des motifs textuels locaux,
sans appel réseau (LEGO : numéro de set ; Apple : gamme + capacité ;
Pokémon/TCG : nom de carte + code de set via une fraction `n/total` ;
Gaming : plateforme + titre ; Photo : marque + modèle, distinction
boîtier/objectif).

La **suffisance** n'est jamais "brand + model + condition" générique : elle
est déclarative par catégorie (`parser/requirement-profiles.ts`,
`extractionRequirementProfile`), avec les **mêmes clés d'attribut que
`@dealradar/core/intelligence/category-profiles.ts`** (`setNumber`,
`cardName`+`setCode`, `model`+`storageGb`, `platform`+`productName`,
`gearType`+`model`) — une extraction suffisante est directement exploitable
par le filtre d'identité d'`analyze-listing.ts`, sans mapping
supplémentaire. `condition` n'est **jamais** un champ d'identification :
LEGO peut être identifié par le seul `setNumber`, même si l'état est
inconnu.

L'IA n'est déclenchée que si ces champs précis manquent ou sont sous le
seuil de confiance (0.85 par défaut) — jamais parce qu'un champ générique
et non pertinent (ex. `condition`) est absent.

## Un seul provider réel : OpenAI

L'interface `AIProvider` (`provider/types.ts`) reste multi-provider par
conception (`name`, `model`, `extract()`), mais **un seul provider est
implémenté, testé et documenté dans ce lot** : OpenAI. Anthropic (ou tout
autre futur adaptateur) n'a **aucune implémentation, aucun test HTTP,
aucune variable d'environnement** dans ce lot.

### Ajouter un futur adaptateur

1. Implémenter `AIProvider` dans `packages/ai/src/provider/<nom>.ts`
   (réutiliser `provider/http.ts` pour timeout/retry/backoff — factorisé
   une seule fois, déjà partagé).
2. Ajouter une ligne à `observability/cost-table.ts` (tarif sourcé et daté).
3. Brancher dans `apps/workers/src/ingestion/ai-provider-config.ts` derrière
   une nouvelle valeur d'`AI_PROVIDER`.
4. Aucun changement dans `extraction/extract-product.ts`, `merge.ts`, ni
   dans `packages/ingestion` — l'orchestrateur ne connaît que l'interface.

### Chat Completions vs Responses API

La V1 utilise l'API Chat Completions (`response_format: json_object`) pour
la disponibilité immédiate du modèle mini choisi. Ce choix est **isolé
entièrement dans `provider/openai.ts`** — l'orchestrateur ne voit que
`extract()`. Migration vers l'API Responses (chemin moderne recommandé par
OpenAI pour les modèles récents) possible sans toucher au reste du code.

## Sécurité des images

Politique volontairement restreinte (`image-policy/`) :
- **seules les images déjà collectées par le connecteur eBay autorisé**
  sont éligibles (jamais une URL fournie ailleurs) ;
- allowlist de domaines configurable (`AI_IMAGE_DOMAIN_ALLOWLIST`), HTTPS
  obligatoire, plafond de 4 images ;
- **l'URL est transmise directement au provider par défaut** — aucun
  téléchargement, donc aucune surface SSRF dans le chemin normal ;
- si un téléchargement s'avérait nécessaire (`download-image-securely.ts`,
  actuellement non exercé par le provider OpenAI qui accepte les URLs),
  toutes les protections sont implémentées et testées : résolution DNS
  puis vérification de l'IP (rejet loopback/privée/link-local/metadata
  cloud `169.254.169.254`), connexion épinglée sur l'IP déjà validée
  (empêche un rebinding DNS entre vérification et connexion), taille
  max stricte, détection MIME par octets magiques (pas seulement l'en-tête
  déclaré), timeout, max 2 redirections **chacune revérifiée**, jamais
  l'URL ni le contenu binaire dans les logs.
- cible à terme (hors périmètre de ce lot) : re-servir les images depuis
  Supabase Storage plutôt que l'URL source.

## Numéro de série

Par défaut, **seul `serialNumberDetected: boolean`** existe dans
`ExtractedProduct`. Aucune valeur complète, aucun hash, aucun "last4" —
hors périmètre tant qu'aucun besoin métier concret ne le justifie. Le motif
est également **redacté du texte envoyé au provider** avant construction du
prompt (`prompts/build-prompt.ts`, `redactSerialNumberMentions`). Aucun
test ne trouve de numéro de série en clair dans le produit final, le cache,
ou les logs.

## Fusion par confiance, pas par source figée

`extraction/merge.ts` : une valeur eBay brute (`source: "provided"`)
faiblement confiante ne peut **jamais** écraser une valeur IA fortement
confirmée — le gagnant est toujours déterminé par confiance normalisée, pas
par un ordre de source fixe. Un désaccord mineur réduit la confiance
(-0.3, plancher 0) silencieusement ; un désaccord sur un champ **critique**
pour l'identification produit un `MAJOR_CONTRADICTION` structuré
(`{field, candidates}`) et force une confiance basse — le signal remonte à
Intelligence Core via l'absence de champ d'identité fiable, jamais une
décision prise dans `packages/ai` lui-même.

## Cache — versionné et paresseux

La clé de cache (`cache/compute-key.ts`) intègre **provider, modèle exact,
version de prompt, version de schéma, version de l'extracteur
déterministe, et un fingerprint de contenu** — un changement de n'importe
laquelle de ces dimensions invalide silencieusement les anciennes entrées
(elles deviennent invisibles, jamais servies comme fraîches). Le
fingerprint d'image n'est calculé **que si l'extraction déterministe est
insuffisante** (ordre paresseux strict, vérifié par test dédié) : aucune
annonce identifiable par le texte ne déclenche de sélection/hachage
d'image.

Limite assumée : sans hash de contenu réel (`content_hash` sur
`listing_media`, alimenté seulement si un téléchargement a lieu), le
fingerprint retombe sur les URLs triées — une signature d'URL peut changer
sans que l'image change. TTL réduit (1 jour) dans ce cas contre 30 jours
avec hash de contenu réel.

Purge manuelle (pas de planification automatique dans ce lot, même
politique que `purge_raw_payloads` du Lot 4) :
```sql
select public.purge_expired_ai_cache();
```

## Budget IA — atomique, jamais un simple compteur applicatif

Un `getTodaySpendUsd() → appel IA → recordUsage()` calculé côté application
est vulnérable à une course entre workers concurrents. La garantie
d'atomicité vit **entièrement côté Postgres** (migration 0011) :

- `reserve_ai_budget(provider, model, coût_max, budget_jour, listing_id)` —
  sérialise via `pg_advisory_xact_lock(hashtext(provider || jour))` avant de
  lire le total déjà réservé/consommé du jour, insère une ligne `reserved`
  si le budget le permet, retourne `NULL` sinon (aucun appel réseau ne doit
  alors avoir lieu).
- `finalize_ai_budget(reservation_id, statut, unités, coût_estimé)` —
  ajuste la réservation avec le résultat réel.
- `release_ai_budget(reservation_id)` — libère une réservation jamais
  consommée.

`ai_usage_log` distingue `reserved_cost_usd` (le maximum réservé avant
l'appel) et `estimated_cost_usd` (le coût réel, **une estimation** calculée
depuis les unités retournées par l'API et `cost-table.ts` — jamais une
facture officielle du provider), avec un statut `reserved | completed |
failed | released`.

`packages/ai` reste indépendant de Postgres : il expose seulement
l'interface `BudgetGuard` (`reserve`/`finalize`/`release`), implémentée
dans `packages/ingestion/src/ai-budget-supabase.ts` via ces trois RPC.

**Limite de test assumée** : Docker/Postgres local reste indisponible dans
cet environnement (limite documentée depuis le Lot 4). La garantie
transactionnelle est vérifiée par lecture de la migration SQL et par un
test unitaire simulant la sérialisation en mémoire
(`extraction/__tests__/budget-concurrency.test.ts`) ; un test d'intégration
contre le projet Supabase cloud réel (RPC concurrents) reste à exécuter une
fois des credentials de test dédiés disponibles.

## Dégradation gracieuse

Tous les cas suivants retournent le meilleur résultat déterministe
disponible, avec un `ExtractionWarning` structuré, **jamais un crash du
run** : provider non configuré (aucune variable d'env), timeout, erreur
réseau/HTTP, JSON invalide, réponse invalide au regard du schéma Zod, quota
IA journalier dépassé.

## Critères de réussite mesurables (rapport final)

Taux d'annonces identifiées uniquement par le déterministe · taux
nécessitant l'IA · taux de sorties IA invalides · taux de contradictions ·
latence médiane · coût moyen par appel (calculé, jamais fixe) · précision
sur `packages/ai/src/__fixtures__/reference-listings.ts` (jeu de référence
synthétique, ≥10 exemples par catégorie, aucune donnée personnelle, aucun
entraînement ML).

## Hors périmètre

Aucune page `apps/web`. Aucune modification d'Intelligence Core (Lot 3).
Aucun second provider branché. Aucun entraînement ML. Aucun connecteur
marketplace additionnel.
