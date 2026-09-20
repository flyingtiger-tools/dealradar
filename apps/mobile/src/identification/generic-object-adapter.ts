import type { CategorySlug, AnalysisResult } from "@dealradar/contracts";
import * as Crypto from "expo-crypto";
import { uploadTcgCardPhoto, deleteTcgCardPhoto } from "../api/tcg-upload-client";
import { createAnalysis, pollAnalysisUntilSettled } from "../api/analyses-client";
import type { UniversalCaptureResult } from "../capture/types";
import type { CategoryAdapter, IdentificationCandidate, OnAnalysisProgress, RafAnalysis } from "./types";
import { failedAnalysis } from "./raf-analysis-helpers";

const CONSENT_VERSION = "1";

/**
 * Convertit un `AnalysisResult` (contrat universel, `@dealradar/contracts`
 * — toute catégorie sauf `pokemon_tcg`, qui a son propre adaptateur et son
 * propre mapping, `tcg-adapter.ts`) vers `RafAnalysis` — aucune règle
 * métier réimplémentée ici, seulement un aplatissement des champs déjà
 * produits par `runIntelligencePipeline()` côté backend
 * (`process-analysis.ts`). Même discipline que `fromTcgCardResult` :
 * "identifié" est décidé sur la présence d'un nom de produit, jamais sur
 * `status` seul.
 *
 * `confidence` : `AnalysisResult.confidenceScore` est 0-100 (voir
 * `analysisResultSchema`) — reconverti en 0-1 ici pour respecter le même
 * contrat que `RafAnalysis.confidence` (0-1, voir `fromTcgCardResult` qui y
 * place `identity.confidence` tel quel, et `UniversalCaptureBetaScreen.tsx`
 * qui affiche `Math.round(confidence * 100)`) — jamais une seconde échelle
 * qui diverge silencieusement.
 */
function fromGenericAnalysisResult(result: AnalysisResult, category: CategorySlug, analysisId: string): RafAnalysis {
  if (!result.product.name) {
    return {
      category,
      status: "insufficient_data",
      product: { name: null, setName: result.product.category, collectorNumber: null, language: null },
      confidence: null,
      decision: null,
      dealScore: result.dealScore,
      valuation: { low: null, high: null, currency: null },
      evidence: [],
      missingInformation: [],
      risks: result.warnings,
      analysisId,
    };
  }

  return {
    category,
    status: "identified",
    product: {
      name: result.product.name,
      setName: result.product.category,
      collectorNumber: result.product.modelOrReference,
      language: null,
    },
    confidence: result.confidenceScore / 100,
    decision: result.decision,
    dealScore: result.dealScore,
    valuation: result.resaleRangeConservative
      ? { low: result.resaleRangeConservative.low, high: result.resaleRangeConservative.high, currency: result.resaleRangeConservative.currency }
      : { low: null, high: null, currency: null },
    evidence: result.marketValueEstimate ? [result.marketValueEstimate.provenance] : [],
    missingInformation: [],
    risks: result.warnings,
    analysisId,
  };
}

/**
 * Adaptateur "objet générique" (ADR 0013, LOT "Universal Object Valuation
 * Foundation") — une instance par catégorie non-TCG, même contrat que
 * `tcgAdapter` mais sans branche serverless synchrone : `pokemon_tcg` a
 * `/api/internal/tcg/analyze` (build interne), aucune catégorie générique
 * n'a d'équivalent aujourd'hui — passe donc toujours par
 * `createAnalysis()`/`pollAnalysisUntilSettled()` (file `analysis.process`,
 * `apps/workers/src/jobs/process-analysis.ts`). **Limite honnête** : ce
 * chemin n'aboutit que si le worker Railway qui traite cette file tourne
 * réellement — hors service aujourd'hui (essai expiré, jamais payé, voir
 * les lots précédents), donc `analyze()` timeout proprement après 60s
 * (`pollAnalysisUntilSettled`) plutôt que de rester bloqué indéfiniment —
 * jamais un crash, jamais un faux résultat.
 */
export function createGenericObjectAdapter(category: Exclude<CategorySlug, "pokemon_tcg">): CategoryAdapter {
  return {
    category,

    canHandle(_capture: UniversalCaptureResult, categoryHint: CategorySlug | null): IdentificationCandidate {
      // Même règle que tcgAdapter (ADR 0013) : route explicite depuis
      // l'écran appelant seulement, jamais une catégorie devinée.
      if (categoryHint === category) {
        return { category, confidence: 1, evidence: ["explicit_category_selection"], missingFields: [] };
      }
      return { category: null, confidence: 0, evidence: [], missingFields: ["categoryHint"] };
    },

    async analyze(capture: UniversalCaptureResult, onProgress?: OnAnalysisProgress): Promise<RafAnalysis> {
      const clientRequestId = Crypto.randomUUID();
      let uploaded = false;
      try {
        onProgress?.("uploading");
        const { url } = await uploadTcgCardPhoto(clientRequestId, capture.normalizedImage.uri);
        uploaded = true;

        onProgress?.("submitting");
        const created = await createAnalysis({
          sourceType: "mobile_camera",
          sourcePlatform: null,
          sharedUrl: null,
          title: null,
          description: null,
          categorySlug: category,
          purchasePrice: null,
          currency: "CHF",
          imageReferences: [{ url }],
          consentVersion: CONSENT_VERSION,
          clientRequestId,
          providedTcgHints: null,
        });

        onProgress?.("polling");
        const settled = await pollAnalysisUntilSettled(created.id);
        void deleteTcgCardPhoto(clientRequestId);

        if (settled.status === "pending" || settled.status === "processing") {
          return failedAnalysis(category, "Délai dépassé — l'analyse n'a pas abouti à temps.");
        }
        if (!settled.result || "kind" in settled.result) {
          return failedAnalysis(category, "Réponse du serveur inattendue pour cette catégorie.");
        }
        return fromGenericAnalysisResult(settled.result, category, settled.id);
      } catch (e) {
        if (uploaded) void deleteTcgCardPhoto(clientRequestId);
        return failedAnalysis(category, e instanceof Error ? e.message : "Erreur inconnue lors de l'identification.");
      }
    },
  };
}

/** Toutes les catégories déclarées sauf `pokemon_tcg` (propre adaptateur, `tcg-adapter.ts`) — source : `categorySlugSchema` (`@dealradar/contracts`), recopiée ici plutôt qu'importée dynamiquement pour que l'ajout d'une catégorie future exige une revue explicite de ce fichier (jamais un adaptateur générique silencieusement créé pour une catégorie non encore auditée côté mobile). */
export const GENERIC_CATEGORIES: readonly Exclude<CategorySlug, "pokemon_tcg">[] = [
  "lego",
  "apple",
  "gaming",
  "photo",
  "sneakers",
  "watches",
  "pc_components",
  "collectibles",
  "general",
];

export const genericObjectAdapters: readonly CategoryAdapter[] = GENERIC_CATEGORIES.map(createGenericObjectAdapter);
