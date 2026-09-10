import { z } from "zod";

/**
 * Vocabulaire de dataset TCG à vérité terrain — source de vérité UNIQUE,
 * partagée entre `packages/benchmark/src/tcg` (validation/chargement d'un
 * dataset exporté) et `apps/mobile` (outil dev "TCG Dataset Capture" qui
 * produit ce format localement, sans réseau). Vit dans `@dealradar/contracts`
 * parce que les deux paquets en dépendent déjà directement — jamais une
 * dépendance nouvelle ajoutée seulement pour ce partage (même discipline que
 * `MIN_OVERALL_CONFIDENCE_FOR_AUTO_CORROBORATION`, `packages/ai`).
 *
 * Champs alignés sur `TcgCardExtraction` (`@dealradar/ai`) pour permettre une
 * comparaison champ par champ directe — jamais un vocabulaire parallèle qui
 * nécessiterait un mapping supplémentaire.
 */

/**
 * Tags qualité/difficulté — chaque exemple peut en porter plusieurs. Servent
 * à segmenter les métriques par difficulté (ex. "quelle précision sur les
 * photos taguées 'glare' seulement ?"), jamais à filtrer silencieusement le
 * dataset global.
 */
export const tcgDatasetTagSchema = z.enum([
  "perfect",
  "glare",
  "low_light",
  "angle",
  "blur",
  "crop",
  "french",
  "english",
  "leading_zero",
  "ambiguous",
  "similar_card",
  "hard_number",
]);
export type TcgDatasetTag = z.infer<typeof tcgDatasetTagSchema>;

/** Toutes les valeurs possibles, dans l'ordre déclaré ci-dessus — pour peupler un sélecteur de tags sans dupliquer la liste. */
export const TCG_DATASET_TAGS: readonly TcgDatasetTag[] = tcgDatasetTagSchema.options;

/**
 * Vérité terrain pour une photo. `collectorNumber` conserve la valeur BRUTE
 * telle que saisie/lue sur la carte physique — jamais normalisée ici : la
 * normalisation (retrait du "/total" et des zéros de tête) est calculée à la
 * volée au moment de la comparaison benchmark, via
 * `collectorNumbersMatch()`/`normalizeCollectorNumber()`
 * (`@dealradar/connectors`), jamais en écrivant une seconde valeur dans ce
 * schéma.
 */
export const tcgGroundTruthSchema = z.object({
  id: z.string().min(1),
  /** Chemin relatif au répertoire du dataset (ex. "photos/nymble-096.jpg") — jamais une URL distante, jamais une image encodée en base64 dans le JSON. */
  imagePath: z.string().min(1),
  game: z.string().min(1),
  cardName: z.string().min(1),
  setName: z.string().nullable(),
  collectorNumber: z.string().nullable(),
  language: z.string().nullable(),
  variant: z.string().nullable(),
  productKind: z.enum(["raw_card", "graded_card"]).nullable(),
  gradingCompany: z.string().nullable(),
  grade: z.string().nullable(),
  notes: z.string().optional(),
  tags: z.array(tcgDatasetTagSchema).default([]),
});
export type TcgGroundTruth = z.infer<typeof tcgGroundTruthSchema>;

/** Version du format — incrémenter uniquement en cas de changement de forme incompatible (jamais pour un simple ajout de champ optionnel). Sert à `apps/mobile` (manifest local) et à un futur avertissement de migration côté benchmark. */
export const TCG_DATASET_FORMAT_VERSION = 1;

export const tcgDatasetSchema = z.object({
  /** "synthetic" : aucune vraie photo. "real" : vraies photos déposées (voir README). Jamais agrégées ensemble (même règle que le dataset eBay). */
  provenance: z.enum(["synthetic", "real"]),
  note: z.string().optional(),
  entries: z.array(tcgGroundTruthSchema),
});
export type TcgDataset = z.infer<typeof tcgDatasetSchema>;
