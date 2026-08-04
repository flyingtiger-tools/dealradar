# ADR 0013 — Stratégie d'identification « AI Last »

**Statut** : accepté · **Date** : 2026-08-03

## Contexte

La session de debugging du 2026-08-02/03 (correctifs successifs : JSON enrobé Markdown chez Claude, `confidence` nullable, normalisation du numéro de collection pour les requêtes catalogue, padding des zéros de tête dans `corroborateCatalogIdentity`) a démontré que le pipeline actuel — photo → extraction IA plein cadre → catalogue → corroboration — reste structurellement fragile sur un point précis : la lecture d'un texte imprimé minuscule (numéro de collection TCG, quelques millimètres, souvent sur fond holographique) par un modèle de vision généraliste, même après compression réduite (LOT 8A) et consigne de prompt ciblée. Sur six scans consécutifs de la même carte physique, deux seulement ont produit une lecture exacte du numéro — les autres échecs relevant tantôt de la lecture elle-même, tantôt d'une indisponibilité tierce de la Pokémon TCG API (500/502/504 observés en direct), jamais d'un bug de notre pipeline une fois les correctifs ci-dessus appliqués.

Ce constat déplace le diagnostic : l'IA en tant que **point d'entrée systématique** de l'identification est le facteur limitant, pas les paramètres qui l'entourent (compression, prompt, retries). Cet ADR acte un changement de stratégie plutôt qu'un nouveau correctif ponctuel.

## Décision — AI Last

L'identification d'un produit ne passe plus par l'IA en premier recours. L'ordre devient :

1. **Déterministe d'abord** : code-barres/QR natif si présent, puis OCR sur une image redressée (détection de document + correction de perspective), puis recherche catalogue avec les indices obtenus.
2. **IA en arbitrage** : uniquement lorsque la corroboration catalogue produit 2-3 candidats plausibles sans identité unique — tâche fermée (« lequel de ces candidats correspond à la photo ? »), structurellement plus fiable qu'une extraction ouverte. La mesure de confiance qui déclenche ce recours est le nombre de candidats retenus à égalité de score catalogue (0 → échec, 1 → succès déterministe, ≥2 → arbitrage), jamais un score numérique inventé pour ce lot.
3. **IA en dernier recours** : uniquement lorsqu'aucun texte exploitable n'a pu être extrait par la voie déterministe (comportement équivalent au pipeline actuel, mais devenu l'exception plutôt que la règle).

L'IA n'est donc jamais supprimée du pipeline — son rôle change de **point d'entrée obligatoire** à **filet de sécurité conditionnel**.

## Priorité : fiabilité et latence, pas uniquement le coût

Le coût actuel d'un appel Claude Haiku 4.5 est déjà de l'ordre de quelques millièmes de dollar par scan (budget journalier de $5 largement suffisant à l'échelle actuelle) — l'économie directe permise par « AI Last » est réelle mais secondaire. Le bénéfice principal recherché est :
- **la fiabilité** : un code-barres lu en local ne dépend d'aucune disponibilité tierce (la Pokémon TCG API a été observée instable — 500/502/504 — indépendamment de tout code applicatif) ;
- **la latence** : une lecture on-device (barcode, OCR) répond en centaines de millisecondes contre 1 à 4 secondes pour un aller-retour IA ;
- **le fonctionnement hors-ligne partiel** : la capture, la détection de document et l'OCR ne nécessitent aucun réseau — seule la recherche catalogue et l'éventuel arbitrage IA en gardent besoin.

Le succès de cette stratégie doit se mesurer sur ces trois axes, jamais uniquement sur le $/scan.

## Rattachement à ADR 0012

Aucune nouvelle architecture n'est introduite : ADR 0012 définit déjà un moteur agnostique à la catégorie, une indirection par capacités versionnées, et le principe *« le moteur exprime des besoins, jamais des choix technologiques »*. Cet ADR ajoute :
- une nouvelle capacité, `identification.extract.v1`, distincte de l'actuelle `vision.extract.v1` (réservée à l'IA) ;
- une **5ᵉ famille de connecteurs** — *Identification Connectors* — couvrant les fournisseurs déterministes (barcode, OCR + règles) de cette capacité, au même titre que l'AI Connector existant reste un fournisseur (de dernier recours) de la même capacité ;
- aucune modification du Capability Engine, du Connector Registry, ni de `packages/core` — conformément à la règle ADR 0012 « ajouter une catégorie/un connecteur ne touche jamais le moteur ». L'extension d'une 5ᵉ famille est explicitement anticipée et autorisée par la règle d'évolution n°4 de cet ADR.

## Architecture générique multi-catégories

Chaque catégorie reste une **configuration**, jamais du code câblé en dur (principe déjà en vigueur, ADR 0012) :

```
CategoryProfile {
  categorySlug
  barcodeApplicable: boolean
  ocrFieldPatterns: RegexRule[]
  catalogConnectors: string[]      // capacités déjà génériques
  corroborationFields: string[]    // champs comparés, généralisés (voir Limites)
}
```

Le moteur de capture (voir Lot « Universal Capture Intake », section suivante) ne connaît aucun champ spécifique à une catégorie — il produit un résultat générique (image normalisée, régions détectées, codes-barres, signaux de qualité) consommé ensuite par un *adapter* propre à chaque catégorie.

## Limites structurelles — objets sans code-barres

Cette stratégie profite très inégalement selon la catégorie :
- **Produits scellés avec code-barres** (livres, jeux vidéo, électronique, LEGO en boîte) : gain quasi total, identification en centaines de millisecondes, IA quasi jamais nécessaire.
- **Objets sans code-barres** (cartes TCG vendues à l'unité, LEGO en vrac, vêtements sans étiquette scannable) : aucun code-barres n'existe physiquement — le gain vient uniquement de l'amélioration de l'image transmise (document détecté, perspective corrigée, crop haute résolution de la zone de texte) avant OCR **et** avant un éventuel appel IA. Le mur physique de lisibilité (texte de quelques millimètres, reflet, angle) reste le même défi qu'il soit lu par un moteur OCR embarqué ou par un modèle de vision — cette catégorie continuera structurellement à solliciter l'IA plus souvent que la moyenne, au moins tant qu'aucune preuve empirique contraire n'est établie.

Ce constat n'invalide pas la stratégie — il en précise le périmètre réaliste et évite de la présenter comme la solution universelle au problème de fiabilité observé sur les cartes TCG.

## Choix technique — capture caméra (Phase A)

La première mise en œuvre du « Universal Capture Intake » (Phase A) utilise **Expo
Camera**, pas VisionCamera : une étude comparative de faisabilité a montré que les frame
processors et la détection live temps réel de VisionCamera ne sont pas nécessaires au
MVP — la Phase A se limite à un « cadre assumé » (région supposée, pas de détection de
contour réelle) et une lecture de code-barres native déjà fournie par Expo Camera sans
dépendance supplémentaire. Ce choix reste **réversible** : aucune migration vers
VisionCamera tant que des mesures réelles (taux de `POSSIBLE_ROTATION` observé en usage
réel, fréquence d'`OBJECT_TOO_SMALL_IN_FRAME`, latence perçue de détection code-barres)
ne démontrent que l'absence de frame processors est effectivement le facteur limitant.

## Refus du big-bang multi-catégories

Aucune tentative de couvrir « des dizaines de catégories » en un seul lot. L'ordre d'implémentation retenu :

1. **Universal Capture Intake** — fondation générique et réutilisable (caméra, détection de document, correction de perspective, crops, code-barres, métadonnées techniques), sans aucune connaissance d'une catégorie précise, encore moins de Pokémon.
2. **TCG Adapter** — une seule verticale, choisie parce qu'elle est déjà en production et constitue la preuve produit prioritaire, jamais une preuve de concept isolée du reste du système.
3. **Extension à d'autres catégories** — uniquement après mesure réelle des taux de réussite de l'étape 2, jamais anticipée par construction.

La classification locale multi-catégories (TFLite), la généralisation complète de `corroborateCatalogIdentity` au-delà de TCG, et toute nouvelle verticale (vêtements, électronique, LEGO) sont explicitement hors périmètre tant que l'étape 2 n'est pas validée en production.

## Comparatif technologique (indicatif — figures externes non vérifiées en direct)

| Techno | Hors ligne | Coût | Statut de vérification |
|---|---|---|---|
| Google ML Kit (OCR, code-barres, détection de document) | Oui | Gratuit | Documentation officielle, non re-testée en direct pour ce document |
| Apple Vision / VisionKit | Oui (iOS uniquement) | Gratuit | Idem |
| Google Cloud Vision OCR | Non (réseau requis) | Payant — **tarif non revérifié, à confirmer avant tout engagement budgétaire** | Non retenu (contredit hors-ligne et coût minimisé) |
| Tesseract | Oui | Gratuit | Non retenu — précision plus faible sur photos d'objets physiques, écosystème RN peu maintenu |
| PaddleOCR | Oui (via export ONNX) | Gratuit | Non retenu en v1 — aucun wrapper React Native mature |

Aucune affirmation de taux de réussite, de coût ou de quota ci-dessus ne doit être considérée comme contractuelle sans re-vérification au moment de l'implémentation — conformément à la discipline déjà en vigueur dans ADR 0012 (colonnes explicitement marquées « non confirmé »/« à valider »).

## Conséquences

- Aucun fichier de code n'est modifié par cet ADR — document de référence uniquement.
- Le rôle de `packages/ai` change (recours conditionnel au lieu de point d'entrée systématique) mais son code, son prompt, son schéma et son budget guard restent inchangés — seule la fréquence d'appel diminue.
- Le pipeline de pricing, de corroboration existante et de persistance (`packages/ingestion`, `packages/core`) n'est pas modifié par cet ADR.
- Le lot « Universal Capture Intake » (à suivre) est la première mise en œuvre concrète de cet ADR, détaillé séparément avant toute implémentation.
