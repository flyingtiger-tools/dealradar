import { resolveErrorCopy } from "../ErrorState";

/**
 * Tests du composant d'erreur (Phase 30 "error states") — vérifie surtout
 * qu'aucun message technique brut ("Network request failed", "status:
 * failed", "pokemon_tcg") ne peut fuiter jusqu'à l'utilisateur (Phase 18).
 */
describe("resolveErrorCopy", () => {
  it("code connu : renvoie un titre/message dédié, jamais le code brut", () => {
    const { title, message } = resolveErrorCopy({ kind: "code", code: "NO_PRICE" });
    expect(title).not.toMatch(/NO_PRICE/);
    expect(message).not.toMatch(/NO_PRICE/);
    expect(message.length).toBeGreaterThan(0);
  });

  it("les 7 codes connus (Phase 18) résolvent chacun un texte non vide", () => {
    const codes = ["NETWORK_UNAVAILABLE", "BACKEND_UNAVAILABLE", "ANALYSIS_TIMEOUT", "AUTH_REQUIRED", "UPLOAD_FAILED", "LOW_CONFIDENCE", "NO_PRICE"] as const;
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

  it("message brut inconnu : jamais laissé vide, jamais un throw", () => {
    const { message } = resolveErrorCopy({ kind: "message", raw: "une erreur jamais vue auparavant xyz123" });
    expect(message.length).toBeGreaterThan(0);
  });
});
