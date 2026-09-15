# Audit du pack visuel Raf V3 (2026-09-15)

Doc opérationnelle (LOT "package V3"). Package reçu :
`DealRadar_Raf_V3.zip` → `raf_claude_package_v3_verified_clean/` (3
sous-dossiers, 8 images, 3 fichiers `.md`). Chaque fichier a été
réinspecté par ce lot — décodage d'en-tête binaire réel (pas de confiance
au nom/à l'extension), comparaison SHA256 avec le pack V2 déjà audité au
lot précédent.

## Constat préalable important

**Les 8 images de V3 sont, sans exception, strictement identiques
(SHA256 égal) aux fichiers déjà présents dans le pack V2** audité et
documenté au lot précédent (`docs/raf-asset-status.md`). V3 n'apporte
**aucun nouveau pixel** — c'est une sélection organisée d'un sous-ensemble
des mêmes 16 fichiers V2 (8 retenus, 4 explicitement exclus par le
curateur, 4 écartés comme doublons), avec une documentation neuve. Les
conclusions techniques déjà établies au lot précédent pour ces 8 fichiers
restent donc valables tel quel — revérifiées ici, pas seulement recopiées.

## Tableau d'audit

| file | actualFormat | size | alpha | visualQuality | characterConsistency | role | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `01_MASTER_STYLEBOARDS/1000097182.png` | **JPEG réel** malgré l'extension `.png` (signature `FF D8 FF E0`, vérifiée) | 1536×1024, 394 Ko | non (JPEG ne supporte pas l'alpha) | Bonne — texte lisible, mise en page propre | Cohérent avec la direction 3D cartoon canonique | Planche marque/UI/émotions/onboarding complète | **REFERENCE_ART_DIRECTION** | Extension trompeuse — jamais un fichier à traiter comme PNG |
| `01_MASTER_STYLEBOARDS/Styleboard DealRadar avec Raf le pigeon.png` | PNG confirmé | 1536×1024, colorType=2 (RGB, pas d'alpha), 1787 Ko | non | Très bonne — texte lisible, composition claire | Cohérent | Logo, échelle de score, mockups résultat, personnalité, icônes nav | **REFERENCE_ART_DIRECTION** | Un des boards les plus riches et les plus lisibles |
| `01_MASTER_STYLEBOARDS/image-gen-1(4).png` | PNG confirmé | 1536×1024, colorType=2 (pas d'alpha), 2083 Ko | non | Excellente — entièrement lisible, aucune déformation de texte | Cohérent | Board le plus complet : identité, icônes+logo, couleurs, typo, UI (boutons/score/badges), 3 écrans mobile (nouvelle analyse/résultat/comparaison/historique), onboarding 5 écrans, splash, notifications, illustrations | **REFERENCE_ART_DIRECTION** — **RÉFÉRENCE PRIMAIRE** | Le plus complet et le plus fiable des 8 |
| `02_CHARACTER_CORE/Autocollants Raf _ Pigeons en action.png` | PNG confirmé | 1536×1024, colorType=2 (pas d'alpha) | non — **damier de transparence peint, pas réel** (vérifié : aucun canal alpha structurel) | Bonne, lisible | Cohérent | 10 stickers légendés (Merci Raf!/Je cherche…/Analyse en cours/Bonne affaire!/Pépite trouvée!/Hmmm…/Pas sûr…/À éviter!/Aïe aïe aïe!/MÉGA AFFAIRE!) | **REFERENCE_ART_DIRECTION** | Vocabulaire d'états le plus proche de notre `RafState` — utile pour la copy, jamais pour découper un sticker |
| `02_CHARACTER_CORE/Guide des styles et expressions de Raf.png` | PNG confirmé | 1536×1024, colorType=2 (pas d'alpha) | non | Bonne | Compare 6 styles (3D réaliste/3D cartoon/flat/sticker/graffiti/minimal line) + 6 "vibes" alternatives — confirme que "3D cartoon rond et expressif" est la direction retenue | Cohérent (sert justement à le confirmer) | Guide de style comparatif | **REFERENCE_ART_DIRECTION** | Ne jamais mélanger les styles alternatifs dans le produit |
| `02_CHARACTER_CORE/Planche d’expressions de pigeons 3D.png` | PNG confirmé | 1536×1024, colorType=2 (pas d'alpha) | non — **même damier peint, pas réel** | Excellente — 5 expressions légendées, texte lisible, aucune déformation | Très cohérent | 01_mignon/02_malin/03_confiant/04_risque/05_deplume | **REFERENCE_ART_DIRECTION** — **RÉFÉRENCE SECONDAIRE (personnage)** | Meilleure référence pour la fidélité d'expression |
| `02_CHARACTER_CORE/Raf le pigeon fait pouce levé.png` | PNG confirmé | 1024×1536, **colorType=6 (RGBA, alpha réel)**, 2134 Ko | **oui — vérifié par décodage des pixels** (zones de fond alpha=0, sujet alpha=255, bord anti-aliasé propre) | Excellente, seul fichier réellement standalone du pack | Cohérent | Rendu hero seul, pouce levé | **STANDALONE_USABLE** | Seul fichier candidat à un usage direct — **non intégré ce lot**, voir "Décision" plus bas |
| `03_ICON_SYSTEM/Guide des icônes Raf et zones sûres.png` | PNG confirmé | 1254×1254, colorType=2 (pas d'alpha) | non | Bonne | Cohérent | Icône app 1024/exports 512-32/icône maskable Android + zone sûre 66% | **REFERENCE_ART_DIRECTION** — **RÉFÉRENCE TERTIAIRE (icône)** | Aucune des tailles d'export visibles n'est un fichier séparé — un seul board composite |

**Aucun fichier classé `PRODUCTION_READY`.** Aucun classé `REJECTED` — le
curateur du pack V3 a déjà retiré les 4 fichiers de moindre qualité
(`Collection d'assets UI de Raf le pigeon.png`, `Kit UI Raf et ses bonnes
affaires.png`, `Kit de marque Raf pour application mobile.png`,
`image-gen-1(5).png` — tous confirmés être les boards à texte déformé/
style "peluche" incohérent, déjà écartés par mon propre audit V2) et les
doublons (`image-gen-1.png`, `image-gen-1(1).png`, `image-gen-1(2).png`,
`image-gen-1(3).png`).

## Références maîtres (Phase 2)

- **PRIMARY** : `image-gen-1(4).png` — couvre identité, UI, palette,
  score/résultat et navigation/app feel dans un seul board, entièrement
  lisible.
- **SECONDARY** : `Planche d'expressions de pigeons 3D.png` — ancre de
  fidélité du personnage (5 expressions, légendes lisibles, aucune
  déformation).
- **TERTIARY** : `Guide des icônes Raf et zones sûres.png` — seule
  référence pour l'icône app et la zone sûre Android.

Tous les autres fichiers restent des références de support (mood,
vocabulaire, style à éviter) — jamais découpés pour produire un pixel de
l'app (Phase 3).

## Décision sur le fichier standalone

`Raf le pigeon fait pouce levé.png` est, une fois de plus, techniquement
vérifié propre et utilisable (canal alpha réel, bien détouré). Un lot
précédent avait commencé son intégration puis l'avait annulée sur
instruction explicite ("STOP VISUEL"). **Ce lot ne le réintègre pas non
plus** — la consigne de ce lot porte sur le polish structurel et la
préparation du registry, pas sur une nouvelle tentative d'intégration
d'image sans confirmation explicite. Voir "Prochaine étape" dans le
rapport final.
