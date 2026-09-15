# Statut des assets Raf — audit du package visuel (2026-09-15)

Doc opérationnelle (LOT "package visuel Raf"). **Décision prise pendant ce
lot, sur instruction explicite de l'utilisateur : aucun asset du package
n'est intégré dans l'app pour l'instant.** Ce document trace l'audit
effectué et pourquoi, pour que la prochaine session n'ait pas à refaire ce
travail ni à se laisser tromper par les mêmes pièges.

## Contexte de la décision

Le package (`DealRadar_Raf_V2_PART1_CORE.zip` + `..._PART2_REFERENCES.zip`,
16 fichiers dans `source_boards/` + 1 dans `standalone_candidates/`) a été
extrait et audité intégralement. Un asset standalone réellement propre a
été identifié et une intégration a été commencée (registry Raf branché sur
`standalone_candidates/raf-thumbs-up-source.png`, fichiers copiés dans
`apps/mobile/src/assets/raf/`).

**L'utilisateur a interrompu ce travail explicitement** : "Le package Raf
que je t'ai envoyé contient plusieurs anciennes planches de concept
générées par IA avec texte déformé, variations incohérentes de Raf et
éléments non exploitables. [...] n'utilise que les assets standalone
réellement présents dans le repo/package et visuellement propres [...]
Continue uniquement sur le polish structurel."

**Action prise en conséquence** : l'intégration a été intégralement
annulée (`git checkout` sur `registry.ts`, suppression des fichiers copiés
sous `assets/raf/production/` et `assets/raf/reference/`). L'app reste
exactement dans l'état de placeholders du lot précédent — aucune image
Raf réelle n'est chargée nulle part aujourd'hui. Les 5 nouveaux états
(`comparing`/`notifying`/`emptySearch`/`emptyNoResults`/`emptyError`)
restent, car demandés explicitement par l'utilisateur (Phase 5) et
indépendants des boards — ce sont des placeholders comme tous les autres,
aucune image associée.

## Fichiers inspectés — TOUS classés `REFERENCE_ONLY` ou ignorés

Aucun fichier ci-dessous n'a été intégré. Classification par prudence,
conforme à l'instruction : traiter `source_boards/` comme non fiable par
défaut.

| Fichier | Emplacement | Résolution | Alpha réel (vérifié) | Statut |
| --- | --- | --- | --- | --- |
| `Styleboard DealRadar avec Raf le pigeon.png` | source_boards | 1536×1024 | non | REFERENCE_ONLY (ignoré) |
| `image-gen-1.png` | source_boards | 1536×1024 | non | REFERENCE_ONLY (ignoré) |
| `image-gen-1(1).png` | source_boards | 1024×1536 | non | REFERENCE_ONLY (ignoré) |
| `image-gen-1(2).png` | source_boards | 1536×1024 | non | REFERENCE_ONLY (ignoré) |
| `image-gen-1(3).png` | source_boards | 1536×1024 | non | REFERENCE_ONLY (ignoré, non inspecté visuellement — même famille que (1)/(2)) |
| `image-gen-1(4).png` | source_boards | 1536×1024 | non | REFERENCE_ONLY (ignoré, non inspecté visuellement — même famille) |
| `image-gen-1(5).png` | source_boards | 1024×1536 | oui (déclaré) | REFERENCE_ONLY (ignoré, non inspecté visuellement) |
| `Kit UI Raf et ses bonnes affaires.png` | source_boards | 1024×1536 | oui (déclaré) | REFERENCE_ONLY (ignoré — texte déformé, style "plush" incohérent avec la direction canonique) |
| `Kit de marque Raf pour application mobile.png` | source_boards | 1024×1536 | oui (déclaré) | REFERENCE_ONLY (ignoré — même famille, texte déformé) |
| `Collection d'assets UI de Raf le pigeon.png` | source_boards | 1024×1536 | oui (déclaré) | REFERENCE_ONLY (ignoré — noms de fichiers futurs suggérés, texte déformé) |
| `Guide des icônes Raf et zones sûres.png` | source_boards | 1254×1254 | non | REFERENCE_ONLY (ignoré) |
| `Guide des styles et expressions de Raf.png` | source_boards | 1536×1024 | non | REFERENCE_ONLY (ignoré) |
| `Planche d'expressions de pigeons 3D.png` | source_boards | 1536×1024 | non (damier factice peint, pas un vrai canal alpha) | REFERENCE_ONLY (ignoré) |
| `Autocollants Raf : Pigeons en action.png` | source_boards | 1536×1024 | non (même damier factice) | REFERENCE_ONLY (ignoré) |
| `1000097182.png` | source_boards | 1536×1024 | non | REFERENCE_ONLY (ignoré) — **fichier réellement au format JPEG malgré l'extension `.png`** (signature `FF D8 FF E0`, vérifié octet par octet), donc structurellement incapable de porter un canal alpha |
| `raf-thumbs-up-source.png` (= `Raf le pigeon fait pouce levé.png`, même SHA256, confirmé fichier unique) | standalone_candidates | 1024×1536 | **oui, vérifié par décodage des pixels** (zones de fond à alpha 0, sujet à alpha 255, bord anti-aliasé propre) | Intégration commencée puis **annulée sur instruction explicite** — voir ci-dessus |

Chaque ligne "REFERENCE_ONLY" a été vérifiée au niveau de l'en-tête PNG
(résolution, présence structurelle d'un canal alpha) ; 9 des 16 fichiers
ont aussi été inspectés visuellement. Les 3 non inspectés visuellement
(`image-gen-1(3)`, `image-gen-1(4)`, et par extension leur famille) n'ont
révélé, dans les fichiers de la même série effectivement vus, que du
contenu dupliqué ou des variantes mineures — aucune inspection
supplémentaire n'a été jugée nécessaire une fois la décision de ne rien
intégrer prise.

## Pièges constatés (pour la prochaine session)

- **Damier de transparence peint, pas réel** : `Planche d'expressions de
  pigeons 3D.png` et `Autocollants Raf...png` affichent visuellement un
  fond "en damier" qui ressemble à de la transparence — mais leur en-tête
  PNG déclare `colorType=2` (RGB sans canal alpha). Le damier est un motif
  peint par le générateur d'image, pas une vraie transparence. Ne jamais
  déduire la transparence d'un rendu visuel seul.
- **Extension trompeuse** : `1000097182.png` est un JPEG.
- **Texte déformé** : plusieurs boards affichent des légendes destinées à
  suggérer des noms de fichiers futurs (`raf-neutral.png`, etc.) mais le
  texte lui-même est illisible/incohérent (artefact connu de génération
  d'image) — jamais une preuve qu'un fichier séparé existe.
- **Incohérence de style** : au moins deux familles stylistiques
  distinctes coexistent dans le package (rendu "concept art" propre des
  boards `image-gen-1*`/Styleboard vs rendu "jouet en peluche" des boards
  `Kit UI`/`Kit de marque`/`Collection`) — ne jamais mélanger les deux dans
  une intégration future sans décision explicite de l'utilisateur.

## État actuel du registry Raf

Inchangé par rapport au lot précédent, à l'exception des 5 nouveaux états
(placeholders uniquement, aucune image) : voir
`apps/mobile/src/assets/raf/registry.ts` et
`apps/mobile/src/theme/raf-mapping.ts`. Aucun `require()` d'image Raf
n'existe dans le code aujourd'hui.

## Prochaine étape

Si l'utilisateur souhaite réintégrer `raf-thumbs-up-source.png` (l'unique
fichier standalone réellement propre, vérifié par décodage de pixels, pas
seulement par son nom) : le travail technique (recadrage sans perte des
marges transparentes, export WebP ~100 Ko à qualité quasi sans perte) a
déjà été fait une fois dans ce lot et peut être refait rapidement sur
confirmation explicite — rien n'a été perdu, seulement annulé du dépôt.
