import { z } from "zod";
import { categorySlugSchema } from "./category-slug";
import { tcgCardProvidedHintsSchema } from "./tcg-card-analysis-result";

/**
 * Contrat universel d'analyse (Lot Mobile Copilot, ADR 0010) — une seule
 * forme de requête pour web, Android, iPhone, extension de partage, alertes
 * e-mail et agents futurs. `sourceType` ne contamine jamais Intelligence
 * Core : c'est une métadonnée de provenance, jamais une entrée du pipeline.
 */
export const analysisSourceTypeSchema = z.enum([
  "android_screen_capture",
  "ios_share_extension",
  "ios_screenshot_share",
  "mobile_camera",
  "image_upload",
  "shared_url",
  "email_alert",
  "official_connector",
  "manual_entry",
]);
export type AnalysisSourceType = z.infer<typeof analysisSourceTypeSchema>;

export const analysisImageReferenceSchema = z.object({
  url: z.string().url(),
});

export const analysisRequestSchema = z.object({
  sourceType: analysisSourceTypeSchema,
  sourcePlatform: z.string().max(100).nullable().default(null),
  sharedUrl: z.string().url().nullable().default(null),
  title: z.string().max(500).nullable().default(null),
  description: z.string().max(20_000).nullable().default(null),
  /**
   * Intelligence Core (ADR 0007) ne couvre que 5 catégories déclaratives —
   * limite préexistante, pas introduite par ce lot. Sans elle, l'extraction
   * déterministe/les profils de exigence n'ont aucun sens : `null` produit
   * `INSUFFICIENT_DATA` plutôt qu'une catégorie devinée (voir
   * `apps/workers/src/jobs/process-analysis.ts`). Le client est censé la
   * faire confirmer par l'utilisateur (section 12 du brief produit) avant
   * l'analyse financière finale, pas la déduire lui-même.
   */
  categorySlug: categorySlugSchema.nullable().default(null),
  purchasePrice: z.number().nonnegative().nullable().default(null),
  currency: z.string().length(3).default("CHF"),
  imageReferences: z.array(analysisImageReferenceSchema).max(4).default([]),
  consentVersion: z.string().min(1),
  clientRequestId: z.string().uuid(),
  /**
   * Champs corrigés manuellement par l'utilisateur sur l'écran de
   * confirmation d'un scan carte TCG (LOT 8) — n'a de sens que lorsque
   * `categorySlug === "pokemon_tcg"` ; interprété uniquement par cette
   * branche du worker (`process-analysis.ts`), ignoré sinon. Présent =
   * ré-extraction visuelle sautée pour ces champs, corroboration lancée
   * directement avec les valeurs fournies (mêmes règles strictes que le
   * reste du pipeline : aucune correspondance par nom seul).
   */
  providedTcgHints: tcgCardProvidedHintsSchema.nullable().default(null),
});
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
