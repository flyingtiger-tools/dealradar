# Workflow dataset TCG — collecte, export, validation, benchmark

Doc opérationnelle (Phase 21, "long lot local — dataset capture"). Commandes exactes,
aucune prose marketing. COÛT = 0 CHF à chaque étape tant que `--tcg-live` n'est pas
explicitement demandé avec ses garde-fous (voir section 6).

## 1. Collecter (téléphone, hors ligne)

1. Ouvrir l'app mobile en mode dev (`expo start --dev-client`, build de développement
   installé sur le téléphone — jamais un build release, l'outil refuse de se rendre hors
   `__DEV__`).
2. Se connecter normalement (la session existe déjà pour les autres écrans de l'app —
   l'outil "Dataset TCG (dev)" lui-même n'utilise jamais cette session).
3. Onglet "Dataset TCG (dev)" (visible uniquement en dev, absent de tout build release).
4. Onglet interne "Capturer" : cadrer la carte, appuyer sur "Capturer".
5. Vérifier l'aperçu (avertissements qualité éventuels — résolution/flou/lumière/rotation)
   → "Reprendre la photo" pour recommencer, ou "Continuer".
6. Remplir la vérité terrain : nom de la carte (obligatoire), set, numéro de collection
   (**garder le padding réel tel qu'imprimé**, ex. "096"), langue, variante, type de
   produit, société/grade si gradée, notes libres, tags de difficulté.
7. "Enregistrer" — sauvegarde locale uniquement (`expo-file-system`, aucune requête
   réseau). Un avertissement s'affiche si un exemple très similaire existe déjà (jamais
   bloquant).
8. Recommencer pour chaque carte/angle/condition à couvrir (voir section 5, cas
   prioritaires).

Onglet interne "Bibliothèque" : liste tous les exemples enregistrés, permet d'éditer la
vérité terrain d'un exemple existant (jamais une re-capture) ou de le supprimer
(confirmation demandée).

## 2. Exporter (téléphone → PC)

Dans l'onglet "Bibliothèque", bouton "Exporter le dataset (.zip)" :

- Construit `dealradar-tcg-dataset-YYYYMMDD.zip` (`dataset.json` + `images/`) en mémoire
  (écrivain ZIP maison, méthode STORED, aucune dépendance externe).
- **Android** : ouvre le sélecteur de dossier natif (Storage Access Framework) —
  choisir un dossier accessible (ex. Téléchargements) pour pouvoir le récupérer
  ensuite avec l'app Fichiers du téléphone ou un câble USB. Aucun cloud, aucun upload
  automatique.
- Si la permission est refusée ou hors Android : le ZIP reste dans le stockage privé de
  l'app (chemin affiché dans le message de confirmation) — récupérable uniquement via
  `adb pull` ou un outil avec accès root ; toujours préférer la permission SAF quand
  disponible.

## 3. Importer (PC)

```bash
mkdir -p packages/benchmark/datasets/tcg/photos
```

Extraire le ZIP téléchargé : copier son `dataset.json` vers
`packages/benchmark/datasets/tcg/tcg.json` (ou un autre nom, voir `--tcg-dataset=`
ci-dessous) et le contenu de son dossier `photos/` vers
`packages/benchmark/datasets/tcg/photos/`.

## 4. Valider (avant de committer)

```bash
pnpm --filter @dealradar/benchmark bench -- --validate-tcg-dataset=tcg
```

Aucun appel réseau, aucun provider invoqué. Sortie `VALID`/`WARNING`/`INVALID` avec
raisons précises (ids dupliqués, image manquante, extension non supportée, chemin non
sûr, fichier orphelin, doublon probable — même comparaison de numéro de collection que
le reste du projet, `collectorNumbersMatch()`). Ne corrige jamais rien automatiquement —
corriger `dataset.json` à la main puis relancer.

Vérifier avant de committer :
- pas de photo avec des données personnelles visibles en arrière-plan ;
- droits sur les photos confirmés (voir `packages/benchmark/datasets/tcg/README.md`,
  section "Vie privée / droits").

## 5. Cas prioritaires à couvrir

Voir `packages/benchmark/datasets/tcg/README.md` pour la liste complète. Résumé :

- Nymble 96/096 (cas historique du correctif `collectorNumbersMatch()`).
- Zéro de tête (ex. "006").
- Numéro proche (ex. 96 vs 97) — jamais de confusion.
- Carte FR et carte EN.
- Reflet (`glare`), faible lumière (`low_light`), angle (`angle`), flou (`blur`).
- Set ambigu (`ambiguous`), variante proche (`similar_card`), numéro difficile
  (`hard_number`).

## 6. Benchmark simulé (COÛT = 0, par défaut)

```bash
pnpm --filter @dealradar/benchmark bench -- --tcg
```

Aucune clé requise, aucun appel réseau réel — chaque provider de la matrice par défaut
est simulé (`createSimulatedProvider`, délai artificiel 400ms, aucune extraction réelle).
Options :

```bash
# Dataset alternatif (packages/benchmark/datasets/tcg/<nom>.json) :
pnpm --filter @dealradar/benchmark bench -- --tcg --tcg-dataset=<nom>

# Matrice personnalisée :
pnpm --filter @dealradar/benchmark bench -- --tcg --tcg-providers=openai:gpt-4o-mini,groq:llama-3.3-70b-versatile

# Plafonner le nombre d'exemples évalués (fonctionne aussi en mode simulé) :
pnpm --filter @dealradar/benchmark bench -- --tcg --tcg-max-examples=5
```

Le rapport affiche, par provider/modèle : exemples/succès/erreurs, identification exacte,
précision par champ, calibration de confiance, besoin de confirmation, hallucination,
confiance-élevée-mais-faux / confiance-insuffisante-mais-juste / ambiguïté /
succès-hybride, métriques par tag de difficulté, latence (avg/median/p95 — **toujours
SIMULATED en mode simulé**, jamais comparée entre providers), coût (`UNKNOWN` si le
modèle n'a pas d'entrée dans `COST_TABLE`, jamais 0 inventé).

## 7. Benchmark live — préparé, JAMAIS lancé dans ce lot

```bash
# REFUSÉ sans les deux garde-fous explicites (aucun appel réseau, dataset jamais chargé) :
pnpm --filter @dealradar/benchmark bench -- --tcg --tcg-live

# Accepté seulement avec les DEUX garde-fous explicites :
pnpm --filter @dealradar/benchmark bench -- --tcg --tcg-live \
  --confirm-live-cost \
  --tcg-max-examples=5 \
  --tcg-providers=openai:gpt-4o-mini
```

En plus des deux garde-fous ci-dessus, `--tcg-live` ne devient RÉELLEMENT live que pour
les entrées de matrice dont la variable d'environnement de clé correspondante
(`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GROQ_API_KEY`/`OPENROUTER_API_KEY`) est présente —
sinon repli automatique et silencieux sur le simulé, entrée par entrée
(`provider-matrix.ts`). **Non exécuté dans ce lot** — aucune clé réelle n'existe dans cet
environnement de développement.

## 8. Second jeu de données de référence (Phase 8, préparé)

Créer un second fichier sous `packages/benchmark/datasets/tcg/` (ex. `tcg-set-2.json`,
même schéma) pour comparer deux lots de photos indépendants (ex. lot "appareil A" vs lot
"appareil B", ou deux sessions de capture à des dates différentes) :

```bash
pnpm --filter @dealradar/benchmark bench -- --validate-tcg-dataset=tcg-set-2
pnpm --filter @dealradar/benchmark bench -- --tcg --tcg-dataset=tcg-set-2
```

Aucune agrégation automatique entre deux datasets différents (même règle que le dataset
eBay générique) — comparer les rapports manuellement.
