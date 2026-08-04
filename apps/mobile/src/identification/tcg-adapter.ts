import type { CategorySlug } from "@dealradar/contracts";
import type { TcgCardAnalysisResult } from "@dealradar/contracts";
import * as Crypto from "expo-crypto";
import { uploadTcgCardPhoto, deleteTcgCardPhoto } from "../api/tcg-upload-client";
import { createAnalysis, pollAnalysisUntilSettled } from "../api/analyses-client";
import type { UniversalCaptureResult } from "../capture/types";
import type { CategoryAdapter, IdentificationCandidate, RafAnalysis } from "./types";
import { failedAnalysis } from "./raf-analysis-helpers";

const CONSENT_VERSION = "1";
const CATEGORY: CategorySlug = "pokemon_tcg";

/**
 * Convertit un `TcgCardAnalysisResult` (pipeline existant, inchangé) vers le
 * contrat générique `RafAnalysis` — aucune règle métier réimplémentée ici,
 * seulement un renommage/aplatissement des champs déjà produits par
 * `orchestratePokemonPipeline()` côté backend.
 */
function fromTcgCardResult(result: TcgCardAnalysisResult, analysisId: string): RafAnalysis {
  const missingInformation: string[] = [];
  if (!result.extractedFields.cardName) missingInformation.push("cardName");
  if (!result.extractedFields.setName) missingInformation.push("setName");
  if (!result.extractedFields.cardNumber) missingInformation.push("cardNumber");

  if (result.needsConfirmation) {
    return {
      category: CATEGORY,
      status: "needs_confirmation",
      product: {
        name: result.extractedFields.cardName,
        setName: result.extractedFields.setName,
        collectorNumber: result.extractedFields.cardNumber,
        language: result.extractedFields.language,
      },
      confidence: result.extractedFields.confidence,
      decision: null,
      valuation: { low: null, high: null, currency: null },
      evidence: [],
      missingInformation,
      risks: result.warnings,
      analysisId,
    };
  }

  if (!result.identity) {
    return {
      category: CATEGORY,
      status: "insufficient_data",
      product: {
        name: result.extractedFields.cardName,
        setName: result.extractedFields.setName,
        collectorNumber: result.extractedFields.cardNumber,
        language: result.extractedFields.language,
      },
      confidence: result.extractedFields.confidence,
      decision: null,
      valuation: { low: null, high: null, currency: null },
      evidence: [],
      missingInformation,
      risks: result.reason ? [result.reason, ...result.warnings] : result.warnings,
      analysisId,
    };
  }

  // Fourchette dérivée des observations de prix réelles déjà converties par le
  // pipeline (`persist-tcg-price-observation.ts`) — jamais une moyenne, jamais
  // une estimation inventée : `null` si aucune conversion exploitable n'existe.
  const convertedAmountsCents = result.priceObservations
    .map((obs) => obs.conversion?.convertedAmountCents ?? (obs.currency === "CHF" ? obs.amountCents : null))
    .filter((amount): amount is number => amount !== null);

  return {
    category: CATEGORY,
    status: "identified",
    product: {
      name: result.identity.name,
      setName: result.identity.setName,
      collectorNumber: result.identity.cardNumber,
      language: result.identity.language,
    },
    confidence: result.identity.confidence,
    decision: null,
    valuation:
      convertedAmountsCents.length > 0
        ? { low: Math.min(...convertedAmountsCents) / 100, high: Math.max(...convertedAmountsCents) / 100, currency: "CHF" }
        : { low: null, high: null, currency: null },
    evidence: result.priceObservations.map((obs) => `${obs.source}:${obs.provenance}`),
    missingInformation,
    risks: result.warnings,
    analysisId,
  };
}

/**
 * Adaptateur TCG minimal (ADR 0013) — transforme une capture universelle en
 * appel au pipeline TCG existant, sans dupliquer sa logique. Réutilise
 * `uploadTcgCardPhoto`/`createAnalysis`/`pollAnalysisUntilSettled`/
 * `deleteTcgCardPhoto` tels quels (mêmes fonctions que `TcgScanScreen`).
 *
 * Aucun paramètre d'authentification : ces fonctions tirent elles-mêmes le
 * jeton/l'identifiant de la session Supabase courante (`auth/session.ts`,
 * LOT 9) — même contrat que `TcgScanScreen`, jamais une seconde voie.
 */
export const tcgAdapter: CategoryAdapter = {
  category: CATEGORY,

  canHandle(_capture: UniversalCaptureResult, categoryHint: CategorySlug | null): IdentificationCandidate {
    // V1 volontairement minimal : route explicite depuis l'écran appelant
    // (ADR 0013) — `UniversalCaptureResult` ne porte aucun signal
    // spécifique à une catégorie, donc aucune prétention de reconnaissance
    // automatique tant qu'aucune preuve déterministe (code-barres, etc.)
    // n'existe pour cette catégorie.
    if (categoryHint === CATEGORY) {
      return { category: CATEGORY, confidence: 1, evidence: ["explicit_category_selection"], missingFields: [] };
    }
    return { category: null, confidence: 0, evidence: [], missingFields: ["categoryHint"] };
  },

  async analyze(capture: UniversalCaptureResult): Promise<RafAnalysis> {
    const clientRequestId = Crypto.randomUUID();
    let uploaded = false;
    try {
      const { url } = await uploadTcgCardPhoto(clientRequestId, capture.normalizedImage.uri);
      uploaded = true;

      const created = await createAnalysis({
        sourceType: "mobile_camera",
        sourcePlatform: null,
        sharedUrl: null,
        title: null,
        description: null,
        categorySlug: CATEGORY,
        purchasePrice: null,
        currency: "CHF",
        imageReferences: [{ url }],
        consentVersion: CONSENT_VERSION,
        clientRequestId,
        providedTcgHints: null,
      });

      const settled = await pollAnalysisUntilSettled(created.id);
      // Best-effort, jamais bloquant pour l'affichage du résultat (même règle que TcgScanScreen).
      void deleteTcgCardPhoto(clientRequestId);

      if (settled.status === "pending" || settled.status === "processing") {
        return failedAnalysis(CATEGORY, "Délai dépassé — l'analyse n'a pas abouti à temps.");
      }
      if (!settled.result || !("kind" in settled.result) || settled.result.kind !== "pokemon_tcg_card") {
        return failedAnalysis(CATEGORY, "Réponse du serveur inattendue pour une carte TCG.");
      }
      return fromTcgCardResult(settled.result, settled.id);
    } catch (e) {
      if (uploaded) void deleteTcgCardPhoto(clientRequestId);
      return failedAnalysis(CATEGORY, e instanceof Error ? e.message : "Erreur inconnue lors de l'identification.");
    }
  },
};
