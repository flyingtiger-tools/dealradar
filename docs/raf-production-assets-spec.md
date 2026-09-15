# Spec de production — futurs assets réels Raf & marque (2026-09-15)

Doc opérationnelle (LOT "package V3", Phase 26/27). Liste exacte des
fichiers à générer/exporter un jour pour remplacer les placeholders
actuels — **aucun de ces fichiers n'existe aujourd'hui**, aucun n'a été
fabriqué en découpant un board (voir `docs/raf-v3-reference-audit.md`).
Direction artistique de référence : `image-gen-1(4).png` (PRIMARY),
`Planche d'expressions de pigeons 3D.png` (SECONDARY, personnage),
`Guide des icônes Raf et zones sûres.png` (TERTIARY, icône).

Priorités déterminées par la fréquence RÉELLE d'atteinte dans le code
aujourd'hui (`theme/raf-mapping.ts`) — pas seulement par intuition :
`analyzing`/`searching`/`scanning` sont vus à **chaque** scan (les 3
phases réseau réelles), `happy`/`thinking`/`warning` couvrent les 4
statuts d'identification réels ; `goodDeal`/`badDeal`/`gem`/`megaDeal`
(paliers de deal) ne sont **pas encore atteignables** par le scan TCG
aujourd'hui (aucune `decision` produite pour cette catégorie, voir
`raf-mapping.ts`) mais restent prioritaires car ce sont les moments produit
les plus importants une fois ce chemin branché.

## Identité de marque

| filename | usage | dimensions | aspect ratio | background | transparent | safe zone | pose/contenu | priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `assets/brand/dealradar-logo.svg` | Logo complet (mark + wordmark "DealRadar") — headers, splash, marketing | vectoriel | libre (défini par le viewBox) | aucun | oui | marge de respiration ≥ 20% de la hauteur du mark autour du wordmark | Mark radar/cible + texte "DealRadar" | P0 |
| `assets/brand/dealradar-mark.svg` | Mark seul (sans texte) — favicon, avatar de marque, loading | vectoriel | 1:1 | aucun | oui | contenu inscrit dans un cercle de diamètre = 80% du viewBox | Cercle "radar"/cible avec un point relié par une ligne diagonale (forme observée de manière cohérente sur les boards de référence — jamais un fichier séparé) | P0 |
| `assets/app/app-icon-1024.png` | Icône iOS/Android — master | 1024×1024 | 1:1 | opaque (dégradé violet ou couleur pleine — jamais transparent, les stores rejettent une icône avec alpha) | non | contenu utile dans les 90% centraux (marge ~5% par bord) | Mark et/ou Raf, cohérent avec `dealradar-mark.svg` | P0 |
| `assets/app/adaptive-icon-foreground.png` | Foreground Android adaptive icon | 1024×1024 (canvas), contenu utile dans un cercle de 66% | 1:1 | **transparent** (obligatoire — le système compose son propre fond) | oui | zone sûre = cercle de 66% de diamètre centré (norme Android, confirmée par `Guide des icônes Raf et zones sûres.png`) | Mark/Raf seul, sans le fond violet (fond géré séparément par `adaptive-icon-background`) | P0 |
| `assets/app/adaptive-icon-background.png` (ou une couleur unie déclarée dans `app.config.ts`) | Fond de l'adaptive icon Android | 1024×1024 ou couleur unie | 1:1 | opaque | non | — | Dégradé violet uni (`#6A4CFF`→`#5539DB`) suffit — pas besoin d'une image si une couleur unie convient | P1 |
| `assets/app/splash-raf.png` | Écran de démarrage | 1284×2778 (portrait, ratio iPhone Pro Max — Expo recadre automatiquement pour les autres tailles) | ~9:19.5 | sombre (`#0F172A`, cohérent avec le thème) | non (image de fond pleine) | logo/Raf centrés dans le tiers central vertical | Mark + "Raf" + tagline "Ton radar à bonnes affaires.", fond sombre uni ou dégradé très subtil | P0 |

## États Raf (registry `theme/raf-mapping.ts` — 17 valeurs)

Toutes les entrées : **1024×1024, fond transparent (alpha réel, vérifié
au décodage — jamais un damier peint), export PNG ou WebP** (voir
`docs/raf-asset-status.md` pour la méthode de vérification à réappliquer
sur tout nouvel export avant intégration).

| filename | usage (état registry) | pose/expression | priority |
| --- | --- | --- | --- |
| `raf-happy.png` | `happy` — identification réussie | Souriant, décontracté, posture ouverte (proche du standalone déjà audité — voir "Prochaine étape" dans `docs/raf-v3-reference-audit.md`) | **P0** |
| `raf-analyzing.png` | `analyzing` — phase réseau "submitting" | Concentré, penché en avant, un œil légèrement plissé | **P0** |
| `raf-searching.png` | `searching` — phase réseau "polling" | Loupe à la main, tête inclinée | **P0** |
| `raf-scanning.png` | `scanning` — phase réseau "uploading" | Face à l'objectif, posture immobile et attentive | **P0** |
| `raf-warning.png` | `warning` — identification incertaine/échouée | Sourcils froncés, bec légèrement ouvert, posture prudente (jamais paniquée) | **P0** |
| `raf-good-deal.png` | `goodDeal` — palier "BUY" standard (pas encore atteignable par le scan TCG, voir note ci-dessus) | Pouce levé, sourire confiant | **P0** |
| `raf-neutral.png` | `neutral` — avatar par défaut, chrome, empty states génériques | Debout, calme, expression neutre-amicale | P1 |
| `raf-thinking.png` | `thinking` — confirmation requise / palier "average" | Une aile portée au bec, regard interrogatif | P1 |
| `raf-bad-deal.png` | `badDeal` — palier "PASS" | Tête basse, aile qui retombe, jamais moqueur envers l'utilisateur | P1 |
| `raf-empty-search.png` | `emptySearch` — aucune recherche lancée | Assis, loupe posée, posture d'attente | P1 |
| `raf-empty-no-results.png` | `emptyNoResults` — recherche sans résultat | Épaules haussées, bec fermé | P1 |
| `raf-empty-error.png` | `emptyError` — erreur technique | Légèrement penché, une plume qui vole, jamais alarmant | P1 |
| `raf-clever.png` | `clever` — moment "astucieux"/insight | Sourire en coin, un œil plus fermé que l'autre | P2 |
| `raf-gem.png` | `gem` — palier "excellent" | Tient une pierre précieuse, sourire large | P2 |
| `raf-mega-deal.png` | `megaDeal` — palier "exceptionnel" | Posture "célébration" (couronne/lunettes en référence, sans copier un board) | P2 |
| `raf-comparing.png` | `comparing` — comparaison de prix (pas encore utilisé dans le code) | Regarde alternativement deux éléments | P2 |
| `raf-notifying.png` | `notifying` — nouvelle information (pas encore utilisé dans le code) | Une aile levée, posture d'alerte douce | P2 |

## Ordre d'export recommandé

1. `dealradar-mark.svg` (base de tout — logo, icône, splash en dépendent tous).
2. `dealradar-logo.svg`.
3. `app-icon-1024.png` + `adaptive-icon-foreground.png` (première impression avant même l'ouverture de l'app).
4. `splash-raf.png`.
5. Les 8 états P0 (`raf-happy`, `raf-analyzing`, `raf-searching`, `raf-scanning`, `raf-warning`, `raf-good-deal`).
6. Les 6 états P1.
7. Les 5 états P2.

## Intégration future (rappel)

Une fois un fichier réellement disponible : le déposer sous
`apps/mobile/src/assets/raf/production/<nom>.webp` (ou `.png`), vérifier
son alpha réel par décodage de pixels (pas seulement son nom/extension —
voir la méthode dans `docs/raf-asset-status.md`), puis ne modifier QUE
l'entrée correspondante dans `apps/mobile/src/assets/raf/registry.ts`
(`kind: "image"`, `image: require(...)`, `productionReady: true` si le
champ existe). Aucun autre fichier de l'app n'a besoin de changer.
