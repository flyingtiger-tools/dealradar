import type { TcgCardAnalysisResult } from "@dealradar/contracts";

const mockGetCurrentAccessToken = jest.fn();
const mockRecordAnalysisSuccess = jest.fn();
const mockRecordAnalysisError = jest.fn();

jest.mock("../src/auth/session", () => ({
  getCurrentAccessToken: () => mockGetCurrentAccessToken(),
}));

jest.mock("../src/diagnostics/diagnostics-store", () => ({
  recordAnalysisSuccess: (...args: unknown[]) => mockRecordAnalysisSuccess(...args),
  recordAnalysisError: (...args: unknown[]) => mockRecordAnalysisError(...args),
}));

import { analyzeTcgCard, TcgAnalyzeError, TCG_ANALYZE_TIMEOUT_MS } from "../src/api/tcg-analyze-client";

/**
 * Client du pipeline TCG serverless synchrone (`POST /api/internal/tcg/
 * analyze`) — durci au LOT "beta product readiness" (Phases 1/3/4/5/8) :
 * timeout centralisé, validation de réponse stricte (jamais un HTTP 200
 * supposé correct), taxonomie d'erreur unique, diagnostics. Même
 * discipline que `analyses-client.test.ts` : plomberie HTTP réelle
 * vérifiée (fetch et `auth/session` mockés), jamais un vrai réseau touché.
 */

const ACCESS_TOKEN = "test-access-token";
const IMAGE_URL = "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/photo.jpg";

/** Résultat minimal mais RÉELLEMENT valide vis-à-vis de `tcgCardAnalysisResultSchema` — un fixture incomplet masquerait la validation stricte plutôt que de la prouver. */
function validResult(overrides: Partial<TcgCardAnalysisResult> = {}): TcgCardAnalysisResult {
  return {
    kind: "pokemon_tcg_card",
    needsConfirmation: false,
    extractedFields: {
      category: "pokemon_tcg",
      game: "pokemon",
      cardName: "Pikachu",
      setName: "Base Set",
      cardNumber: "58",
      variant: null,
      language: "en",
      productKind: "raw_card",
      gradingCompany: null,
      grade: null,
      confidence: 0.95,
      warnings: [],
    },
    identity: {
      catalogExternalId: "base1-58",
      game: "pokemon",
      name: "Pikachu",
      setName: "Base Set",
      cardNumber: "58",
      variant: null,
      language: "en",
      productKind: "raw_card",
      gradingCompany: null,
      grade: null,
      confidence: 0.97,
      catalogCorroboration: "corroborated",
    },
    priceObservations: [],
    warnings: [],
    reason: null,
    ...overrides,
  };
}

function mockFetchOnce(status: number, body: unknown, { ok }: { ok?: boolean } = {}) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  mockGetCurrentAccessToken.mockReset();
  mockGetCurrentAccessToken.mockResolvedValue(ACCESS_TOKEN);
  mockRecordAnalysisSuccess.mockReset();
  mockRecordAnalysisError.mockReset();
});

describe("analyzeTcgCard", () => {
  it("ni imageUrl ni providedTcgHints : rejette localement, jamais un appel réseau", async () => {
    globalThis.fetch = jest.fn();
    await expect(analyzeTcgCard({})).rejects.toThrow(TcgAnalyzeError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("aucune session active : rejette avant tout appel réseau, code AUTH_REQUIRED", async () => {
    mockGetCurrentAccessToken.mockResolvedValue(null);
    globalThis.fetch = jest.fn();

    await expect(analyzeTcgCard({ imageUrl: IMAGE_URL })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("envoie POST /api/internal/tcg/analyze avec Authorization et le corps JSON (imageUrl) — jamais le signal sérialisé dans le corps", async () => {
    mockFetchOnce(200, { status: "completed", result: validResult() });

    await analyzeTcgCard({ imageUrl: IMAGE_URL });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/internal/tcg/analyze");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(init.signal).toBeDefined();
    const sentBody = JSON.parse(init.body);
    expect(sentBody.imageUrl).toBe(IMAGE_URL);
    expect(sentBody.signal).toBeUndefined();
  });

  it("envoie providedTcgHints tel quel (saisie manuelle, sans imageUrl)", async () => {
    mockFetchOnce(200, { status: "completed", result: validResult() });
    const hints = { cardName: "Pikachu", setName: "Base Set", cardNumber: "58", variant: null, language: null, productKind: null, gradingCompany: null, grade: null };

    await analyzeTcgCard({ providedTcgHints: hints });

    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    const sentBody = JSON.parse(init.body);
    expect(sentBody.providedTcgHints).toEqual(hints);
    expect(sentBody.imageUrl).toBeUndefined();
  });

  it("retourne {status, result} directement — jamais de polling, un seul appel réseau — et enregistre un succès en diagnostics", async () => {
    const result = validResult({ priceObservations: [{ source: "tcgdex", provenance: "cardmarket", amountCents: 963, currency: "CHF", condition: null, variant: null, language: null, gradingCompany: null, grade: null, region: "EU", updatedAt: null, conversion: null, warnings: [] }] });
    mockFetchOnce(200, { status: "completed", result });

    const response = await analyzeTcgCard({ imageUrl: IMAGE_URL });

    expect(response.status).toBe("completed");
    expect(response.result.identity?.name).toBe("Pikachu");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(mockRecordAnalysisSuccess).toHaveBeenCalledTimes(1);
  });

  it("erreur HTTP 401 : code AUTH_REQUIRED, jamais le code brut du serveur exposé sans passer par la taxonomie", async () => {
    mockFetchOnce(401, { error: { code: "UNAUTHORIZED", message: "Jeton invalide." } });

    await expect(analyzeTcgCard({ imageUrl: IMAGE_URL })).rejects.toMatchObject({ code: "AUTH_REQUIRED", message: "Jeton invalide." });
    expect(mockRecordAnalysisError).toHaveBeenCalledWith("AUTH_REQUIRED", "request", expect.any(Number));
  });

  it("erreur HTTP 500+ : code BACKEND_UNAVAILABLE", async () => {
    mockFetchOnce(503, { error: { message: "Service indisponible." } });

    await expect(analyzeTcgCard({ imageUrl: IMAGE_URL })).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  it("erreur HTTP 4xx autre (ex. 422 SSRF guard) : code UNKNOWN_ERROR — jamais un code serveur arbitraire qui contournerait la taxonomie", async () => {
    mockFetchOnce(422, { error: { code: "UNSUPPORTED_IMAGE", message: "Référence d'image hors du stockage propriétaire." } });

    await expect(analyzeTcgCard({ imageUrl: IMAGE_URL })).rejects.toMatchObject({
      code: "UNKNOWN_ERROR",
      message: "Référence d'image hors du stockage propriétaire.",
    });
  });

  it("échec réseau (fetch rejette) : code NETWORK_UNAVAILABLE, jamais l'exception brute", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Network request failed"));

    await expect(analyzeTcgCard({ imageUrl: IMAGE_URL })).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });
    expect(mockRecordAnalysisError).toHaveBeenCalledWith("NETWORK_UNAVAILABLE", "request", expect.any(Number));
  });

  it("JSON invalide dans la réponse : code INVALID_ANALYSIS_RESPONSE, jamais un crash JSON.parse non géré", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }) as unknown as typeof fetch;

    await expect(analyzeTcgCard({ imageUrl: IMAGE_URL })).rejects.toMatchObject({ code: "INVALID_ANALYSIS_RESPONSE" });
  });

  it("réponse 200 structurellement invalide (champs requis manquants) : code INVALID_ANALYSIS_RESPONSE, jamais un HTTP 200 supposé correct (Phase 3)", async () => {
    mockFetchOnce(200, { status: "completed", result: { kind: "pokemon_tcg_card" } });

    await expect(analyzeTcgCard({ imageUrl: IMAGE_URL })).rejects.toMatchObject({ code: "INVALID_ANALYSIS_RESPONSE" });
    expect(mockRecordAnalysisError).toHaveBeenCalledWith("INVALID_ANALYSIS_RESPONSE", "response_validation", expect.any(Number));
  });

  it("timeout centralisé : une constante exportée, jamais une valeur codée en dur ailleurs", () => {
    expect(TCG_ANALYZE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("annulation externe volontaire (Phase 5) : propagée telle quelle, jamais transformée en TcgAnalyzeError affichable", async () => {
    const controller = new AbortController();
    globalThis.fetch = jest.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const abort = () => {
          const abortError = new Error("Aborted");
          abortError.name = "AbortError";
          reject(abortError);
        };
        // Un vrai `fetch` réagit aussi à un signal déjà abandonné au moment
        // de l'appel, pas seulement à un futur événement "abort" — ce mock
        // reproduit cette sémantique plutôt que d'introduire une fausse
        // fenêtre de course propre au test.
        if (init.signal.aborted) abort();
        else init.signal.addEventListener("abort", abort);
      });
    }) as unknown as typeof fetch;

    const promise = analyzeTcgCard({ imageUrl: IMAGE_URL, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    // Une annulation volontaire n'est jamais comptée comme une erreur d'analyse.
    expect(mockRecordAnalysisError).not.toHaveBeenCalled();
  });
});
