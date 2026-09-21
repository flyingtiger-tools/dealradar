const mockGetCurrentAccessToken = jest.fn();

jest.mock("../src/auth/session", () => ({
  getCurrentAccessToken: () => mockGetCurrentAccessToken(),
}));

import { fetchProductHistory, ProductHistoryError } from "../src/api/product-history-client";

const ACCESS_TOKEN = "test-access-token";

const validHistory = {
  history: {
    productKey: "lego:10300",
    asOf: "2026-09-21T00:00:00.000Z",
    recentSnapshotSummaries: [],
    history: {
      asOf: "2026-09-21T00:00:00.000Z",
      sampleSize: 0,
      medianCents: null,
      p25Cents: null,
      p75Cents: null,
      minCents: null,
      maxCents: null,
      outlierCount: 0,
      trends: [],
      activeSupplyCount: 0,
      sourceDiversityOverTime: 0,
      historicalPercentilePosition: null,
      confidence: 0,
      reasons: [],
    },
    activeSupplyCount: 0,
    sourceDiversity: 0,
    freshnessHours: null,
  },
};

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

describe("fetchProductHistory", () => {
  it("productKey vide : rejette localement, jamais un appel réseau", async () => {
    globalThis.fetch = jest.fn();
    await expect(fetchProductHistory("")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("aucune session active : rejette avant tout appel réseau, code AUTH_REQUIRED", async () => {
    mockGetCurrentAccessToken.mockResolvedValue(null);
    globalThis.fetch = jest.fn();

    await expect(fetchProductHistory("lego:10300")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("encode productKey dans l'URL et envoie Authorization", async () => {
    mockFetchOnce(200, validHistory);

    await fetchProductHistory("lego:10300 rare");

    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/internal/operator/product-history?productKey=");
    expect(url).toContain(encodeURIComponent("lego:10300 rare"));
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("réponse valide : retournée telle quelle", async () => {
    mockFetchOnce(200, validHistory);

    const response = await fetchProductHistory("lego:10300");

    expect(response.history.productKey).toBe("lego:10300");
  });

  it("réponse invalide (champ manquant) : INVALID_RESPONSE, jamais un objet partiel propagé", async () => {
    mockFetchOnce(200, { history: { productKey: "lego:10300" } });

    await expect(fetchProductHistory("lego:10300")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("classe d'erreur exportée : instance de ProductHistoryError", async () => {
    mockFetchOnce(401, {});
    try {
      await fetchProductHistory("lego:10300");
      throw new Error("devrait avoir rejeté");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductHistoryError);
    }
  });
});
