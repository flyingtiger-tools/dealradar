# Procédure — premier test Samsung (outil "TCG Dataset Capture")

Doc opérationnelle (Phase 15, "long lot local — dataset capture"). 4 tests, tous
gratuits — **aucun bouton "Analyser" nulle part dans cette procédure**, aucune requête
réseau, aucune session Supabase touchée par l'outil lui-même.

Prérequis : build de développement Expo installé sur le Samsung (`expo run:android` ou
équivalent, jamais un `EAS build` payant), connecté au Metro bundler local.

## Test 1 — flux complet, gratuit

1. Lancer l'app sur le Samsung.
2. Se connecter (session normale de l'app — inchangée par cet outil).
3. Ouvrir l'onglet "Dataset TCG (dev)".
4. Vérifier la demande de permission caméra (accorder).
5. Capturer une photo d'une carte quelconque.
6. Vérifier l'aperçu et les avertissements qualité éventuels.
7. Remplir les tags (au moins un).
8. Enregistrer.
9. Éditer cet exemple depuis la bibliothèque (modifier un champ, ex. les notes) et
   vérifier que la modification est bien conservée après être revenu à la bibliothèque.
10. Supprimer cet exemple — confirmer la demande de confirmation, vérifier qu'il
    disparaît de la bibliothèque.
11. Exporter (bibliothèque vide à ce stade — vérifier que le bouton est désactivé ou
    qu'un message clair indique qu'il n'y a rien à exporter).

**Résultat attendu** : aucun crash, aucun appel réseau (vérifiable via un proxy/
Charles/mitmproxy si disponible, sinon se fier à l'absence de latence réseau perçue —
chaque étape doit être quasi instantanée, contrairement à un appel serveur réel).

## Test 2 — une même carte sous 5 conditions différentes, gratuit

Capturer et enregistrer 5 photos de la MÊME carte :

1. Face normale, bien éclairée, à plat.
2. Avec un angle net (carte inclinée).
3. Avec un reflet visible (tag `glare`).
4. En faible lumière (tag `low_light`).
5. Légèrement floue (tag `blur`).

Pour chacune, remplir la même vérité terrain (nom/set/numéro identiques) — vérifier que
l'app affiche un avertissement de doublon probable à partir de la 2ᵉ capture (jamais
bloquant, juste informatif).

## Test 3 — 5 cartes différentes, gratuit

Capturer et enregistrer 5 cartes distinctes, en couvrant si possible :

- une carte avec un numéro à zéro de tête (ex. "006") ;
- une carte en français ;
- une carte dans un set au nom ambigu (tag `ambiguous`) ;
- une carte gradée (type de produit "Carte gradée", société + grade renseignés) ;
- une carte "parfaite" (tag `perfect`, aucune difficulté).

Vérifier dans la bibliothèque que les 5 exemples sont listés avec la bonne vignette et
les bons tags.

## Test 4 — export et validation côté PC, gratuit

1. Depuis la bibliothèque (10 exemples des tests 2+3), "Exporter le dataset (.zip)".
2. Sur Android : choisir un dossier accessible (ex. Téléchargements) dans le sélecteur
   natif qui s'ouvre.
3. Récupérer le fichier `dealradar-tcg-dataset-YYYYMMDD.zip` sur le PC (câble USB, app
   Fichiers → partage, ou tout moyen habituel — jamais un cloud).
4. Extraire et copier dans `packages/benchmark/datasets/tcg/` (voir
   `docs/tcg-dataset-workflow.md`, section 3).
5. Valider :

```bash
pnpm --filter @dealradar/benchmark bench -- --validate-tcg-dataset=tcg
```

**Résultat attendu** : `VALID` ou `WARNING` (jamais `INVALID` pour un export produit par
l'outil lui-même — si `INVALID`, c'est un bug de l'export à signaler, pas une erreur de
saisie).

## Ce que cette procédure NE couvre PAS

- Aucun test du flux d'analyse réel (`TcgScanScreen`/Universal Capture bêta) — hors
  périmètre de cet outil dev.
- Aucun test réseau réel (upload, création d'analyse, appel provider) — l'outil ne peut
  structurellement pas les déclencher (voir
  `apps/mobile/src/dataset-capture/__tests__/no-network-invariant.test.ts`).
- Aucun run `--tcg-live` — préparé (voir `docs/tcg-dataset-workflow.md`, section 7) mais
  jamais lancé.

## Statut après exécution

Une fois cette procédure réellement suivie sur un Samsung physique, marquer dans
`docs/ai-ingestion-foundation.md` : outil "TCG Dataset Capture" → **DEVICE-TESTED**
(jamais avant — voir la règle de `docs/ai-ingestion-foundation.md`, section statuts).
