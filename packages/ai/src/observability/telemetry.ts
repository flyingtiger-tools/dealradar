import type { ExtractionTelemetry } from "../types";

export function buildTelemetry(partial: Partial<ExtractionTelemetry> & Pick<ExtractionTelemetry, "status">): ExtractionTelemetry {
  return {
    provider: partial.provider ?? null,
    model: partial.model ?? null,
    inputUnits: partial.inputUnits ?? 0,
    outputUnits: partial.outputUnits ?? 0,
    imageCount: partial.imageCount ?? 0,
    latencyMs: partial.latencyMs ?? 0,
    cacheStatus: partial.cacheStatus ?? "not_applicable",
    estimatedCostUsd: partial.estimatedCostUsd ?? 0,
    status: partial.status,
    errorCode: partial.errorCode,
    errorHttpStatus: partial.errorHttpStatus,
    errorMessage: partial.errorMessage,
  };
}
