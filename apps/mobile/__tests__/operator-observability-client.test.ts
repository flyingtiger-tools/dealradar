const mockGetCurrentAccessToken = jest.fn();

jest.mock("../src/auth/session", () => ({
  getCurrentAccessToken: () => mockGetCurrentAccessToken(),
}));

import { fetchOperatorObservability, OperatorObservabilityError } from "../src/api/operator-observability-client";

/**
 * Client `GET /api/internal/operator/observability` (LOT "Interactive
 * History + Generic Result UI + Full Cancellation + Pre-Prod Activation
 * Package", section 5) — même discipline que `tcg-analyze-client.test.ts` :
 * plomberie HTTP réelle vérifiée (fetch et `auth/session` mockés), jamais
 * un vrai réseau touché.
 */

const ACCESS_TOKEN = "test-access-token";

const validSummary = {
  generatedAt: "2026-09-21T00:00:00.000Z",
  recentRuns: [],
  runCount: 0,
  successRate: null,
  failedTargetsByReason: [],
  sourceErrorCounts: [],
  dueTargetCount: 0,
  overdueTargetCount: 0,
  budgetExhaustedRunCount: 0,
  timedOutRunCount: 0,
  observationsPersistedByDay: {},
  topUnresolvedIdentityConflictProducts: [],
  sourceReadiness: [],
  sourceHealth: [],
  unhealthySources: [],
  abortedTargetCount: 0,
  latestSuccessfulTargetAt: null,
  sparseHistoryProductCount: 0,
};

const validHistoricalEngine = { allTablesAvailable: true, tables: [] };

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
});

describe("fetchOperatorObservability", () => {
  it("aucune session active : rejette avant tout appel réseau, code AUTH_REQUIRED", async () => {
    mockGetCurrentAccessToken.mockResolvedValue(null);
    globalThis.fetch = jest.fn();

    await expect(fetchOperatorObservability()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("envoie GET /api/internal/operator/observability avec Authorization", async () => {
    mockFetchOnce(200, { summary: validSummary, historicalEngine: validHistoricalEngine });

    await fetchOperatorObservability();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/internal/operator/observability");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("réponse valide : retournée telle quelle", async () => {
    mockFetchOnce(200, { summary: { ...validSummary, dueTargetCount: 5 }, historicalEngine: validHistoricalEngine });

    const response = await fetchOperatorObservability();

    expect(response.summary.dueTargetCount).toBe(5);
    expect(response.historicalEngine.allTablesAvailable).toBe(true);
  });

  it("HTTP 401 : rejette avec AUTH_REQUIRED", async () => {
    mockFetchOnce(401, { error: { code: "UNAUTHORIZED", message: "x" } });

    await expect(fetchOperatorObservability()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("HTTP 500 : rejette avec BACKEND_UNAVAILABLE", async () => {
    mockFetchOnce(500, { error: { code: "INTERNAL", message: "x" } });

    await expect(fetchOperatorObservability()).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  it("réponse 200 mais forme invalide (champ manquant) : rejette avec INVALID_RESPONSE, jamais un objet partiellement typé propagé", async () => {
    mockFetchOnce(200, { summary: { dueTargetCount: 1 } });

    await expect(fetchOperatorObservability()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("échec réseau (fetch rejette) : NETWORK_UNAVAILABLE", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error("réseau indisponible"));

    await expect(fetchOperatorObservability()).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });
  });

  it("classe d'erreur exportée : instance de OperatorObservabilityError", async () => {
    mockFetchOnce(401, {});
    try {
      await fetchOperatorObservability();
      throw new Error("devrait avoir rejeté");
    } catch (error) {
      expect(error).toBeInstanceOf(OperatorObservabilityError);
    }
  });
});
