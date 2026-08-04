import type { CategorySlug } from "@dealradar/contracts";
import type { RafAnalysis } from "./types";

/** Aucun adaptateur n'a revendiqué la capture — jamais une catégorie devinée. */
export function insufficientDataAnalysis(missingInformation: string[]): RafAnalysis {
  return {
    category: null,
    status: "insufficient_data",
    product: { name: null, setName: null, collectorNumber: null, language: null },
    confidence: null,
    decision: null,
    valuation: { low: null, high: null, currency: null },
    evidence: [],
    missingInformation,
    risks: [],
    analysisId: null,
  };
}

/** Échec réseau/serveur/upload — jamais un prix ou une identité inventée pour combler le vide. */
export function failedAnalysis(category: CategorySlug | null, message: string): RafAnalysis {
  return {
    category,
    status: "failed",
    product: { name: null, setName: null, collectorNumber: null, language: null },
    confidence: null,
    decision: null,
    valuation: { low: null, high: null, currency: null },
    evidence: [],
    missingInformation: [],
    risks: [message],
    analysisId: null,
  };
}
