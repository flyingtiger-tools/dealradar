import type { TcgDatasetTag } from "@dealradar/contracts";
import type { OrientationInfo, QualitySignals, QualityWarningCode } from "../capture/types";

/**
 * Outil dev "TCG Dataset Capture" (long lot local, Phase 1/2/3) — collecte
 * de photos TCG réelles SANS réseau, pour alimenter
 * `packages/benchmark/datasets/tcg/`. Ce module ne doit JAMAIS importer les
 * clients d'upload/d'analyse réseau ni les modules d'authentification/session
 * du reste de l'app mobile — voir `__tests__/no-network-invariant.test.ts`,
 * qui vérifie mécaniquement cette règle en lisant le code source de ce
 * dossier (recherche de motifs interdits, y compris les chemins d'import
 * concernés — volontairement non recopiés ici tels quels pour ne pas
 * déclencher cette même recherche sur ce commentaire).
 *
 * `groundTruthDraftSchema`/`DatasetGroundTruthDraft` reflète volontairement
 * les mêmes champs que `TcgGroundTruth` (`@dealradar/contracts`), MOINS `id`
 * et `imagePath` — ces deux champs sont dérivés par le stockage local
 * (`storage.ts`) et par l'export (`export-dataset.ts`), jamais saisis par
 * l'utilisateur. Un seul vocabulaire de vérité terrain existe dans ce
 * dépôt (Phase 3) : jamais un second format concurrent ici.
 */

export interface DatasetGroundTruthDraft {
  game: string;
  cardName: string;
  setName: string | null;
  collectorNumber: string | null;
  language: string | null;
  variant: string | null;
  productKind: "raw_card" | "graded_card" | null;
  gradingCompany: string | null;
  grade: string | null;
  notes: string;
  tags: TcgDatasetTag[];
}

export function emptyGroundTruthDraft(): DatasetGroundTruthDraft {
  return {
    game: "pokemon",
    cardName: "",
    setName: null,
    collectorNumber: null,
    language: null,
    variant: null,
    productKind: null,
    gradingCompany: null,
    grade: null,
    notes: "",
    tags: [],
  };
}

/**
 * Un exemple sauvegardé localement — `localImageUri` pointe vers une copie
 * durable sous `FileSystem.documentDirectory` (jamais l'URI de cache éphémère
 * produite par la caméra, qui peut être purgée par l'OS entre deux
 * lancements de l'app). Aucun champ de session/authentification/GPS ici.
 */
export interface DatasetCaptureExample {
  id: string;
  createdAt: string;
  updatedAt: string;
  localImageUri: string;
  qualityWarnings: QualityWarningCode[];
  qualitySignals: QualitySignals;
  orientation: OrientationInfo;
  groundTruth: DatasetGroundTruthDraft;
}

export const DATASET_CAPTURE_MANIFEST_VERSION = 1;

export interface DatasetCaptureManifest {
  version: number;
  examples: DatasetCaptureExample[];
}

export function emptyManifest(): DatasetCaptureManifest {
  return { version: DATASET_CAPTURE_MANIFEST_VERSION, examples: [] };
}
