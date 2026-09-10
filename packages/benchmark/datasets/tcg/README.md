# Dataset TCG — vérité terrain pour `extractTcgCardFromPhoto()`

Statut : **PREPARED** — structure et outillage prêts, **aucune vraie photo n'est encore
incluse**. Ce dossier existe pour recevoir 50 à 100 photos réelles prises au téléphone,
annotées à la main, sans qu'aucun code ne change quand elles arriveront.

Distinct de `packages/benchmark/datasets/pokemon_tcg.json` (dataset eBay générique —
une *annonce* eBay de catégorie `pokemon_tcg`, pas une photo de carte).

## Structure attendue

```
packages/benchmark/datasets/tcg/
  tcg.json          <- fichier de vérité terrain (voir schéma ci-dessous)
  photos/           <- vos vraies photos (jamais committées telles quelles sans accord — voir "Vie privée")
    nymble-096.jpg
    ...
```

`tcg.json` :

```json
{
  "provenance": "real",
  "entries": [
    {
      "id": "nymble-096",
      "imagePath": "photos/nymble-096.jpg",
      "game": "pokemon",
      "cardName": "Nymble",
      "setName": "Phantasmal Flames",
      "collectorNumber": "096",
      "language": "en",
      "variant": null,
      "productKind": "raw_card",
      "gradingCompany": null,
      "grade": null,
      "notes": "Numéro imprimé en 096/094 sur la carte physique.",
      "tags": ["leading_zero", "hard_number"]
    }
  ]
}
```

### Champs de vérité terrain

| Champ | Type | Sens |
|---|---|---|
| `id` | string | Identifiant unique de l'exemple |
| `imagePath` | string | Chemin relatif à ce dossier (jamais une URL distante) |
| `game` | string | Ex. "pokemon" |
| `cardName` | string | Nom réel de la carte |
| `setName` | string \| null | Nom du set/extension |
| `collectorNumber` | string \| null | Numéro tel qu'imprimé (garder le padding réel, ex. "096") |
| `language` | string \| null | Langue réelle de la carte |
| `variant` | string \| null | Variante (Illustration Rare, Full Art…) |
| `productKind` | "raw_card" \| "graded_card" \| null | |
| `gradingCompany` | string \| null | Si gradée |
| `grade` | string \| null | Si gradée |
| `notes` | string (optionnel) | Contexte libre |
| `tags` | tableau de tags (voir ci-dessous) | |

### Tags de difficulté/qualité

`perfect`, `glare`, `low_light`, `angle`, `blur`, `crop`, `french`, `english`,
`leading_zero`, `ambiguous`, `similar_card`, `hard_number` — un exemple peut porter
plusieurs tags. Servent à segmenter les métriques par difficulté, jamais à filtrer le
dataset silencieusement.

## Cas que nous voulons absolument couvrir

- **Nymble 96/096** — le cas exact ayant motivé le correctif `collectorNumbersMatch()`
  (padding de zéro entre Pokémon TCG API et TCGdex) — au moins une photo réelle de cette
  carte précise.
- **leading zero** — un numéro imprimé avec un zéro de tête (ex. "006").
- **numéro proche** — deux cartes du même set avec des numéros très proches (ex. 96 vs
  97) pour vérifier qu'aucune confusion n'a lieu.
- **carte FR** — au moins une carte en français.
- **carte EN** — au moins une carte en anglais.
- **reflet** (`glare`) — photo avec un reflet sur le holographique.
- **faible lumière** (`low_light`).
- **angle** (`angle`) — carte photographiée de travers, jamais parfaitement à plat.
- **mauvaise qualité** (`blur`) — photo floue.
- **set ambigu** (`ambiguous`) — le nom de set seul ne suffit pas à distinguer deux
  éditions.
- **variation proche** (`similar_card`) — deux cartes visuellement très proches
  (variante commune vs illustration rare de la même carte).

## Vie privée / droits

Les photos de cartes appartiennent à leur propriétaire. Avant d'ajouter de vraies
photos à ce dépôt, confirmer qu'elles peuvent être committées (pas de données
personnelles visibles en arrière-plan, pas de contrainte de droits d'image spécifique).

## Lancer le benchmark sur ce dataset

```bash
pnpm --filter @dealradar/benchmark bench -- --tcg
```

Mode simulé par défaut (COÛT = 0, aucune clé requise, aucun appel réseau réel — voir
`packages/benchmark/src/tcg/provider-matrix.ts`). Options :

- `--tcg-dataset=<nom>` — charge `datasets/tcg/<nom>.json` (défaut : `tcg`).
- `--tcg-providers=openai:gpt-4o-mini,groq:llama-3.3-70b-versatile` — matrice
  personnalisée (défaut : les 4 providers avec leur modèle par défaut).
- `--tcg-live` — **désactivé par défaut** ; nécessite en plus une vraie clé API dans
  l'environnement pour le provider concerné, sinon repli automatique sur le mode simulé.
  Ne jamais activer ce flag sans un accord explicite sur le coût.
