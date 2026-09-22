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
  /**
   * Annulation INTERACTIVE demandée par l'utilisateur (LOT "Product
   * History UX + Source Health + Interactive Cancellation + Beta
   * Readiness", section 6/7) — état TERMINAL distinct de `"failed"` : une
   * annulation n'est JAMAIS une panne fournisseur. Voir migration 0026
   * (`cancel_requested_at`, RPC `request_analysis_cancellation`).
   */
  "cancelled",
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
/** Reflète `FxRate` (`@dealradar/connectors/fx/types.ts`) — donnée publique par nature (taux de change), jamais une valeur sensible. */
export const marketEvidenceFxRateSchema = z.object({
  baseCurrency: z.string(),
  quoteCurrency: z.string(),
  rate: z.number(),
  rateDate: z.string(),
  source: z.string(),
  fetchedAt: z.string(),
});

/** Classe de coût déclarative (voir `SourceCostClass`, `@dealradar/connectors`) — jamais un montant réel, jamais un système de facturation. */
export const marketEvidenceCostClassSchema = z.enum(["free", "cheap", "paid", "high_cost"]);

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
  /**
   * Diagnostics étendus (LOT "Source Wave 3", section 9) — TOUS optionnels
   * individuellement pour rester rétrocompatibles avec tout appelant qui
   * construirait encore un `marketEvidence` au format du lot précédent
   * (Source Wave 2) sans ces champs.
   */
  directSourceCount: z.number().optional(),
  aggregatorSourceCount: z.number().optional(),
  evidenceTypeMix: z.array(z.object({ evidenceType: z.string(), count: z.number() })).optional(),
  costClassesUsed: z.array(marketEvidenceCostClassSchema).optional(),
  fx: z
    .object({
      observedCurrencies: z.array(z.string()),
      ratesUsed: z.array(marketEvidenceFxRateSchema),
      skippedForMissingRateCount: z.number(),
    })
    .optional(),
  /**
   * Calibration qualité/historique (LOT "Data Quality Calibration +
   * Operator Observability + Mobile Market Insight Contract") — reflète
   * `QualityFlag[]`/`FusedValuation.trendDescriptor`/`trendConfidence`/
   * `historicalReferenceMedianCents` (`@dealradar/core/intelligence/
   * fuse-market-observations.ts`) SANS jamais importer ce type ici (même
   * discipline que le reste du fichier : `@dealradar/contracts` ne dépend
   * jamais de `@dealradar/core`) — `qualityFlags` reste donc un tableau de
   * chaînes non contraint côté schéma. `trendDescriptor`/`trendConfidence`/
   * `historicalReferenceMedianCents` restent `null` tant qu'aucun contexte
   * d'historique n'est fourni à la fusion — le chemin d'analyse interactif
   * (`process-analysis.ts`) ne le fait pas encore aujourd'hui (la lecture
   * d'historique existe séparément, voir `queryProductHistory`,
   * `@dealradar/ingestion`) — jamais une valeur devinée ici.
   */
  qualityFlags: z.array(z.string()).optional(),
  historicalReferenceMedianCents: z.number().nullable().optional(),
  trendDescriptor: z.string().nullable().optional(),
  trendConfidence: z.number().nullable().optional(),
  /**
   * Position (0–100) du PRIX D'ACHAT CONFIRMÉ par l'utilisateur dans la
   * distribution historique connue (LOT "Interactive History + Generic
   * Result UI + Full Cancellation + Pre-Prod Activation Package", section
   * 1) — jamais la position de la valeur juste fusionnée elle-même (deux
   * questions différentes : "ce prix est-il bon historiquement" vs "quelle
   * est la valeur juste"). `null` sans historique exploitable.
   */
  currentVsHistoryPercentile: z.number().nullable().optional(),
});
export type MarketEvidence = z.infer<typeof marketEvidenceSchema>;

/**
 * Comment l'identité produit a été établie (LOT "Live Identity Enrichment
 * + Barcode-First + upc.dev Fallback + Railway Readiness", section 1/12)
 * — user-facing, jamais un libellé technique brut. `visual_only` reste le
 * défaut honnête tant qu'AUCUNE source catalogue exacte n'a confirmé quoi
 * que ce soit (voir `enrichProductIdentity`, `@dealradar/ingestion`).
 */
export const identityQualityMethodSchema = z.enum(["barcode_confirmed", "lego_catalog_confirmed", "visual_only"]);

/** Un désaccord DUR entre l'extraction IA et une source catalogue exacte, déjà résolu en faveur du catalogue (voir `mergeIdentityEvidence`, `@dealradar/core`) — exposé pour transparence, jamais caché à l'utilisateur. */
export const identityConflictSchema = z.object({
  field: z.string(),
  aiValue: z.string().nullable(),
  catalogValue: z.string().nullable(),
});

export const identityQualitySchema = z.object({
  method: identityQualityMethodSchema,
  /** Sources catalogue effectivement consultées (jamais une source PRIX — voir `SOURCE_READINESS_MATRIX`, capability catalogIdentity/barcodeLookup uniquement). */
  sourcesConsulted: z.array(z.string()),
  conflicts: z.array(identityConflictSchema),
});
export type IdentityQuality = z.infer<typeof identityQualitySchema>;

export const analysisResultSchema = z.object({
  /**
   * Clé produit canonique DÉJÀ RÉSOLUE (LOT "Product History UX + Source
   * Health + Interactive Cancellation + Beta Readiness", section 2) — voir
   * `deriveProductKey` (`@dealradar/core`), `apps/workers/src/jobs/
   * process-analysis.ts`. `null`/absent avant qu'une identité minimale
   * (catégorie + état + prix confirmés) ne soit connue — jamais devinée.
   * Permet au mobile de naviguer vers l'historique produit
   * (`GET /api/internal/operator/product-history?productKey=...`) sans
   * reconstruire cette clé côté client (logique métier réservée au
   * serveur).
   */
  productKey: z.string().nullable().optional(),
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
  /**
   * Absent = chemin qui n'a jamais tenté d'enrichissement d'identité
   * catalogue (ex. résultat produit avant ce lot, ou verticale TCG qui
   * n'utilise jamais ce champ). Présent = un `enrichProductIdentity` a
   * réellement tourné, `method: "visual_only"` inclus si aucune source
   * catalogue n'a confirmé quoi que ce soit — jamais omis silencieusement
   * juste parce que l'enrichissement n'a rien trouvé.
   */
  identityQuality: identityQualitySchema.optional(),
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
