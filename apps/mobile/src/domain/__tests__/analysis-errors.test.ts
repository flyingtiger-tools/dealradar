import { mapAnalysisErrorToUserMessage, type AnalysisErrorCode } from "../analysis-errors";

const ALL_CODES: AnalysisErrorCode[] = [
  "NETWORK_UNAVAILABLE",
  "REQUEST_TIMEOUT",
  "UPLOAD_FAILED",
  "BACKEND_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "INVALID_ANALYSIS_RESPONSE",
  "LOW_CONFIDENCE",
  "NO_MATCH",
  "NO_PRICE",
  "AUTH_REQUIRED",
  "UNKNOWN_ERROR",
];

describe("mapAnalysisErrorToUserMessage", () => {
  it("résout les 11 codes de la taxonomie (Phase 8) avec un titre/message non vides", () => {
    for (const code of ALL_CODES) {
      const info = mapAnalysisErrorToUserMessage(code);
      expect(info.code).toBe(code);
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.message.length).toBeGreaterThan(0);
      expect(typeof info.retryable).toBe("boolean");
    }
  });

  it("NO_PRICE n'est jamais présenté comme un échec (Phase 8) — le titre reste positif", () => {
    const info = mapAnalysisErrorToUserMessage("NO_PRICE");
    expect(info.title.toLowerCase()).not.toMatch(/échec|erreur|impossible/);
    expect(info.retryable).toBe(false);
  });

  it("LOW_CONFIDENCE reste 'retryable' (jamais un échec complet, juste une invitation à vérifier)", () => {
    expect(mapAnalysisErrorToUserMessage("LOW_CONFIDENCE").retryable).toBe(true);
  });

  it("AUTH_REQUIRED n'est jamais 'retryable' par un simple nouvel essai (il faut se reconnecter d'abord)", () => {
    expect(mapAnalysisErrorToUserMessage("AUTH_REQUIRED").retryable).toBe(false);
  });

  it("aucun titre/message ne contient un détail technique brut (code HTTP, nom de provider, JSON)", () => {
    for (const code of ALL_CODES) {
      const info = mapAnalysisErrorToUserMessage(code);
      expect(info.title).not.toMatch(/network request failed|status:|pokemon_tcg|\{|\[/i);
      expect(info.message).not.toMatch(/network request failed|status:|pokemon_tcg|\{|\[/i);
    }
  });
});
