const mockGetCurrentAccessToken = jest.fn();

jest.mock("../src/auth/session", () => ({
  getCurrentAccessToken: () => mockGetCurrentAccessToken(),
}));

import { createAnalysis, getAnalysis, AnalysesApiError } from "../src/api/analyses-client";

/**
 * Vérifie la plomberie réelle du client mobile (ADR 0010, LOT 9) :
 * construction de la requête HTTP, authentification, validation Zod,
 * gestion d'erreur — sans jamais toucher un vrai Supabase (fetch et
 * `auth/session` mockés). Le jeton n'est plus un paramètre : il vient
 * systématiquement de la session courante (LOT 9), jamais saisi
 * manuellement — voir le test dédié "aucune session active" ci-dessous.
 */

const ACCESS_TOKEN = "test-access-token";
const CLIENT_REQUEST_ID = "11111111-1111-1111-1111-111111111111";

function mockFetchOnce(status: number, body: unknown) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  mockGetCurrentAccessToken.mockReset();
  mockGetCurrentAccessToken.mockResolvedValue(ACCESS_TOKEN);
});

describe("createAnalysis", () => {
  it("envoie POST /api/v1/analyses avec l'en-tête Authorization (jeton de la session courante) et le corps JSON validé", async () => {
    mockFetchOnce(202, { id: "22222222-2222-2222-2222-222222222222", status: "pending", result: null });

    await createAnalysis({
      sourceType: "manual_entry",
      sourcePlatform: null,
      sharedUrl: null,
      title: null,
      description: null,
      categorySlug: null,
      purchasePrice: null,
      currency: "CHF",
      imageReferences: [],
      consentVersion: "1",
      clientRequestId: CLIENT_REQUEST_ID,
      providedTcgHints: null,
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/v1/analyses");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    const sentBody = JSON.parse(init.body);
    expect(sentBody.clientRequestId).toBe(CLIENT_REQUEST_ID);
    expect(sentBody.sourceType).toBe("manual_entry");
  });

  it("aucune session active : refuse avant tout appel réseau, jamais un jeton vide envoyé", async () => {
    mockGetCurrentAccessToken.mockResolvedValue(null);
    globalThis.fetch = jest.fn();

    await expect(
      createAnalysis({
        sourceType: "manual_entry",
        sourcePlatform: null,
        sharedUrl: null,
        title: null,
        description: null,
        categorySlug: null,
        purchasePrice: null,
        currency: "CHF",
        imageReferences: [],
        consentVersion: "1",
        clientRequestId: CLIENT_REQUEST_ID,
        providedTcgHints: null,
      }),
    ).rejects.toMatchObject(new AnalysesApiError("UNAUTHENTICATED", "Aucune session active — connecte-toi avant de lancer une analyse."));

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejette localement (Zod) une requête invalide avant tout appel réseau", async () => {
    globalThis.fetch = jest.fn();

    await expect(
      createAnalysis({
        // sourceType invalide : ne fait partie d'aucune valeur de l'enum.
        sourceType: "not_a_real_source" as never,
        sourcePlatform: null,
        sharedUrl: null,
        title: null,
        description: null,
        categorySlug: null,
        purchasePrice: null,
        currency: "CHF",
        imageReferences: [],
        consentVersion: "1",
        clientRequestId: CLIENT_REQUEST_ID,
        providedTcgHints: null,
      }),
    ).rejects.toThrow();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("propage une erreur structurée (code + message) quand le serveur répond une erreur", async () => {
    mockFetchOnce(429, { error: { code: "RATE_LIMITED", message: "Trop de requêtes." } });

    await expect(
      createAnalysis({
        sourceType: "manual_entry",
        sourcePlatform: null,
        sharedUrl: null,
        title: null,
        description: null,
        categorySlug: null,
        purchasePrice: null,
        currency: "CHF",
        imageReferences: [],
        consentVersion: "1",
        clientRequestId: CLIENT_REQUEST_ID,
        providedTcgHints: null,
      }),
    ).rejects.toMatchObject(new AnalysesApiError("RATE_LIMITED", "Trop de requêtes."));
  });
});

describe("getAnalysis", () => {
  it("envoie GET /api/v1/analyses/:id avec l'en-tête Authorization (jeton de la session courante)", async () => {
    const analysisId = "22222222-2222-2222-2222-222222222222";
    mockFetchOnce(200, { id: analysisId, status: "completed", result: null });

    await getAnalysis(analysisId);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain(`/api/v1/analyses/${analysisId}`);
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });
});
