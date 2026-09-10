import { z } from "zod";

/**
 * Structure de dataset TCG à vérité terrain (Phase 7, ADR 0013) — sert
 * uniquement à mesurer `extractTcgCardFromPhoto()` (l'étape IA du pipeline
 * TCG) contre des photos réelles annotées à la main. Aucune image n'est
 * fournie dans ce lot : cette structure permet seulement de déposer plus
 * tard nos vraies photos (voir `packages/benchmark/datasets/tcg/README.md`).
 *
 * Distinct de `../dataset/schema.ts` (dataset eBay générique) : un jeu TCG
 * décrit une PHOTO annotée, pas une annonce marketplace — vocabulaire et
 * usage entièrement différents, jamais mélangés dans une même agrégation.
 */

/**
 * Tags qualité/difficulté — chaque entrée peut en porter plusieurs. Servent
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

/**
 * Vérité terrain pour une photo — champs alignés sur `TcgCardExtraction`
 * (`@dealradar/ai`) pour permettre une comparaison champ par champ directe,
 * jamais un vocabulaire parallèle qui nécessiterait un mapping supplémentaire.
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

export const tcgDatasetSchema = z.object({
  /** "synthetic" : aucune vraie photo pour l'instant (ce lot). "real" : vraies photos déposées (voir README). Jamais agrégées ensemble (même règle que le dataset eBay). */
  provenance: z.enum(["synthetic", "real"]),
  note: z.string().optional(),
  entries: z.array(tcgGroundTruthSchema),
});
export type TcgDataset = z.infer<typeof tcgDatasetSchema>;
