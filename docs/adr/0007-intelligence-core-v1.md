# ADR 0007 — Intelligence Core V1 : moteur de décision générique

**Statut** : accepté · **Date** : 2026-07-26

## Contexte

`scoring/deal-score.ts` (ADR 0006) est déjà branché sur Supabase et calcule un
score simple à partir de comparables déjà matérialisées en base. Le Lot 3
construit un système plus large — normalisation, identification par
catégorie, filtrage, estimation, profit net, trois scores, décision finale
explicable — sans dépendre d'une marketplace réelle. Ce module devra plus
tard alimenter des connecteurs concrets (eBay, Ricardo…), mais aucun n'existe
encore : il doit rester utilisable et testable dès aujourd'hui, en isolation.

## Décisions

**Nouveau dossier `packages/core/src/intelligence/`, distinct de `scoring/`.**
`types/domain.ts` a pour contrat déclaré d'être aligné sur les migrations
Supabase ; les types de ce module (`NormalizedListing`, `NormalizedComparable`…)
ne le sont pas — ils décrivent l'entrée/sortie d'un moteur pur, sans I/O.
`scoring/` continue d'exister tel quel, toujours branché aux workers.

**Comparables « vendus » uniquement pour l'estimation de prix.** Un candidat
sans `soldAt` (annonce active, prix demandé) n'est jamais utilisé pour
calculer médiane/quartiles — seul un prix de vente confirmé reflète une
valeur de marché. C'est la raison d'être de la capacité `soldPrices` déclarée
sur `MarketplaceConnector`, distincte de `search` (annonces actives).

**Filtrage des valeurs aberrantes par IQR (1.5×), désactivé sous 4
échantillons.** Sur un échantillon aussi petit, la borne IQR n'est pas fiable :
mieux vaut ne rien exclure que de déclarer arbitrairement un point aberrant.

**`asOf` explicite dans `IntelligencePipelineInput`, jamais `Date.now()`
interne.** Condition non négociable pour un moteur pur/déterministe/testable :
le score de liquidité dépend de la fraîcheur des ventes, donc du temps — ce
temps doit être une entrée, pas un effet de bord.

**Profils de catégorie = données, jamais de code dupliqué.** `CategoryProfile`
est une configuration déclarative (champs obligatoires, critères de
similarité, signaux de risque, seuils de confiance) consommée par un moteur
générique unique (`identify.ts`, `comparables.ts`, `scores.ts`). Aucune
branche `if (category === "lego")` n'existe où que ce soit — ajouter une 6e
catégorie ne touche qu'à `category-profiles.ts`.

**Filtres structurels globaux avant la similarité du profil.** Catégorie,
devise et condition sont vérifiées pour tout candidat, indépendamment du
profil — un designer de profil ne peut pas accidentellement mélanger des
devises ou des états différents dans une même estimation.

**La garde « données insuffisantes » est le premier test de `decide()`.**
Avant même de regarder le Deal Score : `INSUFFICIENT_DATA` dès que les
comparables vendus exploitables sont sous le plancher ou que la confiance est
trop basse. Aucun chemin du code ne peut produire `BUY` dans ce cas — c'est
la règle produit non négociable (jamais de fausse précision).

**Recommandation forte (`BUY`) exige un plancher de comparables *et* une
confiance forte, tous deux paramétrables par profil.** Un profil à variance
ou risque de fraude plus élevé (Pokémon/TCG, Photo) relève son propre
plancher au-delà du minimum générique de 5.

## Conséquences

- Le module compile et s'exécute sans aucune dépendance réseau : testable en
  isolation totale, déterministe par construction.
- `MarketplaceConnector` reste une interface non implémentée en V1 — le
  pipeline ne l'appelle jamais, il consomme des candidats déjà rassemblés.
  Câbler un connecteur réel (Lot futur) n'impose aucun changement à ce module.
- `apps/workers/src/db.ts` lit désormais `SUPABASE_URL` (alias serveur) au
  lieu de `NEXT_PUBLIC_SUPABASE_URL`, qui n'a pas de sens hors d'un bundle
  Next.js.
