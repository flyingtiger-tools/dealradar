import { describe, expect, it } from "vitest";
import { emptyWebFetchMetrics } from "../types";
import { recordFetchFailure, recordFetchSuccess, recordParsingOutcome } from "../record-web-fetch-metrics";

describe("record-web-fetch-metrics — accumulateurs purs, jamais d'état caché", () => {
  it("recordFetchSuccess incrémente le compte et journalise la latence", () => {
    const metrics = recordFetchSuccess(emptyWebFetchMetrics(), 120);
    expect(metrics.fetchSuccessCount).toBe(1);
    expect(metrics.latenciesMs).toEqual([120]);
  });

  it("recordFetchFailure sans blocage : incrémente uniquement les échecs", () => {
    const metrics = recordFetchFailure(emptyWebFetchMetrics());
    expect(metrics.fetchFailureCount).toBe(1);
    expect(metrics.blockedCount).toBe(0);
  });

  it("recordFetchFailure avec blocage : incrémente aussi blockedCount", () => {
    const metrics = recordFetchFailure(emptyWebFetchMetrics(), { blocked: true });
    expect(metrics.blockedCount).toBe(1);
  });

  it("recordParsingOutcome succès : incrémente parsingSuccessCount uniquement", () => {
    const metrics = recordParsingOutcome(emptyWebFetchMetrics(), { success: true });
    expect(metrics.parsingSuccessCount).toBe(1);
    expect(metrics.parsingFailureCount).toBe(0);
  });

  it("recordParsingOutcome échec avec prix/titre manquants et dérive détectée : incrémente les trois", () => {
    const metrics = recordParsingOutcome(emptyWebFetchMetrics(), {
      success: false,
      missingPrice: true,
      missingTitle: true,
      parseDrift: true,
    });
    expect(metrics.parsingFailureCount).toBe(1);
    expect(metrics.missingPriceCount).toBe(1);
    expect(metrics.missingTitleCount).toBe(1);
    expect(metrics.parseDriftCount).toBe(1);
  });

  it("les accumulateurs ne mutent jamais l'objet reçu (immutabilité)", () => {
    const initial = emptyWebFetchMetrics();
    recordFetchSuccess(initial, 10);
    expect(initial.fetchSuccessCount).toBe(0);
  });
});
