/**
 * Structure de dataset TCG à vérité terrain (Phase 7, ADR 0013) — sert
 * uniquement à mesurer `extractTcgCardFromPhoto()` (l'étape IA du pipeline
 * TCG) contre des photos réelles annotées à la main.
 *
 * Distinct de `../dataset/schema.ts` (dataset eBay générique) : un jeu TCG
 * décrit une PHOTO annotée, pas une annonce marketplace — vocabulaire et
 * usage entièrement différents, jamais mélangés dans une même agrégation.
 *
 * Le schéma lui-même vit dans `@dealradar/contracts` (source de vérité
 * unique, voir `packages/contracts/src/tcg-dataset.ts`) : ce fichier ne fait
 * que ré-exporter, jamais redéfinir — `apps/mobile` (outil dev "TCG Dataset
 * Capture") produit exactement ce même format localement, sans second
 * vocabulaire à faire correspondre.
 */
export {
  tcgDatasetTagSchema,
  TCG_DATASET_TAGS,
  tcgGroundTruthSchema,
  tcgDatasetSchema,
  TCG_DATASET_FORMAT_VERSION,
  type TcgDatasetTag,
  type TcgGroundTruth,
  type TcgDataset,
} from "@dealradar/contracts";
