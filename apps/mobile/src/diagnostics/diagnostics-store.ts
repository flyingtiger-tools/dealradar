/**
 * Diagnostics internes en mémoire (LOT "beta product readiness", Phase 33/
 * 35/36) — jamais persisté sur disque, jamais envoyé à un service externe
 * (aucun analytics/monitoring — interdit explicitement pour ce lot).
 * Réinitialisé à chaque redémarrage de l'app (état module simple, pas un
 * store réactif — l'écran Diagnostics relit ces valeurs à l'ouverture,
 * pas besoin d'abonnement temps réel pour un écran interne consulté à la
 * demande).
 *
 * Ne mémorise jamais une pile d'erreur complète ni un corps de réponse —
 * seulement un code, une étape ("stage"), une durée et un horodatage
 * (Phase 36 : "pas besoin de sauvegarder des stacks sensibles").
 */

export type AnalysisStage = "upload" | "request" | "response_validation" | "mapping";

export interface LastAnalysisInfo {
  status: "success" | "error";
  durationMs: number;
  timestamp: string;
}

export interface LastErrorInfo {
  code: string;
  stage: AnalysisStage;
  timestamp: string;
}

let lastAnalysis: LastAnalysisInfo | null = null;
let lastError: LastErrorInfo | null = null;

export function recordAnalysisSuccess(durationMs: number): void {
  lastAnalysis = { status: "success", durationMs, timestamp: new Date().toISOString() };
}

export function recordAnalysisError(code: string, stage: AnalysisStage, durationMs: number): void {
  const timestamp = new Date().toISOString();
  lastAnalysis = { status: "error", durationMs, timestamp };
  lastError = { code, stage, timestamp };
}

export function getLastAnalysis(): LastAnalysisInfo | null {
  return lastAnalysis;
}

export function getLastError(): LastErrorInfo | null {
  return lastError;
}

/** Utilisé par les tests et par un futur bouton "Réinitialiser les diagnostics" — jamais appelé automatiquement en production. */
export function resetDiagnostics(): void {
  lastAnalysis = null;
  lastError = null;
}
