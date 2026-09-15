import { resolveErrorCopy } from "../ErrorState";
import type { AnalysisErrorCode } from "../../../domain/analysis-errors";

/**
 * Tests du composant d'erreur (Phase 8/9, LOT "beta product readiness") —
 * `resolveErrorCopy` délègue maintenant à `domain/analysis-errors.ts`
 * (source unique) ; ce fichier vérifie seulement le comportement du
 * wrapper `{kind: "code" | "message"}` propre à `ErrorState`, la
 * couverture complète des 11 codes vit dans
 * `domain/__tests__/analysis-errors.test.ts`.
 */
describe("resolveErrorCopy", () => {
  it("code connu : délègue à la taxonomie canonique, jamais le code brut affiché", () => {
    const { title, message } = resolveErrorCopy({ kind: "code", code: "NO_PRICE" });
    expect(title).not.toMatch(/NO_PRICE/);
    expect(message).not.toMatch(/NO_PRICE/);
    expect(message.length).toBeGreaterThan(0);
  });

  it("les 11 codes de la taxonomie (Phase 8) résolvent chacun un texte non vide", () => {
    const codes: AnalysisErrorCode[] = [
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
    for (const code of codes) {
      const { title, message } = resolveErrorCopy({ kind: "code", code });
      expect(title.length).toBeGreaterThan(0);
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("message brut réseau : nettoyé via cleanUserMessage, jamais affiché tel quel", () => {
    const { message } = resolveErrorCopy({ kind: "message", raw: "Network request failed" });
    expect(message).not.toMatch(/network request failed/i);
  });

  it("message brut inconnu : jamais laissé vide, jamais un throw, code UNKNOWN_ERROR (retryable)", () => {
    const info = resolveErrorCopy({ kind: "message", raw: "une erreur jamais vue auparavant xyz123" });
    expect(info.message.length).toBeGreaterThan(0);
    expect(info.code).toBe("UNKNOWN_ERROR");
    expect(info.retryable).toBe(true);
  });
});
