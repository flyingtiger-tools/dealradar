import { z } from "zod";
import { tcgCardAnalysisResultSchema } from "./tcg-card-analysis-result";

/**
 * Enveloppe Zod du résultat d'analyse universel (ADR 0010) — validée à la
 * frontière API, jamais un second moteur de décision. Les valeurs
 * `decision`/scores/`whyPanel` proviennent telles quelles de
 * `runIntelligencePipeline()` (`@dealradar/core`) ; `@dealradar/contracts`
 * ne dépend jamais de `@dealradar/core` (sens de dépendance inverse), donc
 * ce schéma reflète la forme de `Decision`/`IntelligenceScores`/`WhyPanel`
 * sans les importer — toute divergence future entre les deux doit être
 * corrigée ici, pas contournée.
 */

/** Reflète `Decision` (`@dealradar/core/intelligence/types.ts`). */
export const analysisDecisionSchema = z.enum(["BUY", "REVIEW", "PASS", "INSUFFICIENT_DATA"]);

/**
 * Nature réelle de la donnée de marché utilisée — jamais affiché comme
 * "dernières ventes" si la source n'est qu'un guide de prix ou une annonce
 * active (règle produit absolue, section 6 du brief).
 */
export const marketDataProvenanceSchema = z.enum([
  "sold_transaction",
  "market_guide",
  "active_listing",
  "retail_price",
  "estimated_value",
  "unknown",
]);

export const analysisMoneySchema = z.object({
  amount: z.number(),
  currency: z.string().length(3),
});

export const analysisStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "insufficient_data",
]);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

/**
 * Palier de preuve du moteur de fusion multi-source (LOT "Source Wave 2")
 * — reflète `EvidenceQualityTier` (`@dealradar/core/intelligence/fuse-
 * market-observations.ts`), jamais importé ici pour la même raison que le
 * reste du fichier (`@dealradar/contracts` ne dépend jamais de
 * `@dealradar/core`).
 */
export const marketEvidenceTierSchema = z.enum(["A", "B", "C", "D", "E"]);

/**
 * Provenance détaillée de l'évidence de marché multi-source, OPTIONNELLE
 * (LOT "Source Wave 2", section 7) — absente pour tout résultat produit
 * avant ce lot (TCG, ou chemin générique n'ayant pas eu besoin
 * d'enrichissement multi-source) : jamais une régression de contrat pour
 * les consommateurs existants (mobile) qui l'ignorent simplement. Ne
 * remplace jamais `dataAvailability`/`marketValueEstimate.provenance`
 * (déjà utilisés par le chemin TCG et le chemin générique existant) — les
 * complète avec le détail que seule la fusion multi-source peut fournir.
 */
export const marketEvidenceSchema = z.object({
  strongestTier: marketEvidenceTierSchema.nullable(),
  sourceCount: z.number(),
  observationCount: z.number(),
  liveObservationCount: z.number(),
  historicalObservationCount: z.number(),
  sourceNames: z.array(z.string()),
  retailOnlyWarning: z.boolean(),
  activeListingsOnlyWarning: z.boolean(),
  usedSpecialistHistory: z.boolean(),
});
export type MarketEvidence = z.infer<typeof marketEvidenceSchema>;

export const analysisResultSchema = z.object({
  product: z.object({
    name: z.string().nullable(),
    category: z.string().nullable(),
    modelOrReference: z.string().nullable(),
  }),
  conditionEstimated: z.string().nullable(),
  priceDetected: analysisMoneySchema.nullable(),
  marketValueEstimate: analysisMoneySchema
    .extend({ provenance: marketDataProvenanceSchema })
    .nullable(),
  resaleRangeConservative: z.object({ low: z.number(), high: z.number(), currency: z.string().length(3) }).nullable(),
  grossMargin: z.number().nullable(),
  estimatedFees: z.number().nullable(),
  netMargin: z.number().nullable(),
  // Échelle 0-100, identique à `computeConfidenceScore`/`computeLiquidityScore`/
  // `computeDealScore` (`@dealradar/core/intelligence/scores.ts`) — jamais
  // renormalisée en 0-1, pour ne pas introduire une seconde échelle qui
  // pourrait diverger silencieusement de celle d'Intelligence Core.
  confidenceScore: z.number().min(0).max(100),
  liquidityScore: z.number().min(0).max(100),
  dealScore: z.number().min(0).max(100).nullable(),
  decision: analysisDecisionSchema,
  warnings: z.array(z.string()),
  reasons: z.array(z.string()),
  dataAvailability: z.object({
    soldTransactions: z.boolean(),
    marketGuide: z.boolean(),
  }),
  /** Absent = pas d'enrichissement multi-source pour ce résultat (voir `marketEvidenceSchema`). */
  marketEvidence: marketEvidenceSchema.optional(),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/**
 * `result` peut être soit une décision générique (Intelligence Core), soit
 * un résultat de scan de carte TCG (`kind: "pokemon_tcg_card"`, LOT 8) —
 * jamais les deux à la fois. Les deux formes sont suffisamment distinctes
 * (champs requis différents) pour que `z.union` les distingue sans
 * ambiguïté, sans qu'il soit nécessaire de faire porter un discriminant à
 * `analysisResultSchema` lui-même (déjà consommé ailleurs sans `kind`).
 */
export const analysisResponseSchema = z.object({
  id: z.string().uuid(),
  status: analysisStatusSchema,
  result: z.union([tcgCardAnalysisResultSchema, analysisResultSchema]).nullable(),
});
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
