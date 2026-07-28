import { createAnalysis, getAnalysis, AnalysesApiError } from "../src/api/analyses-client";

/**
 * Vérifie la plomberie réelle du client mobile (ADR 0010) : construction de
 * la requête HTTP, authentification, validation Zod, gestion d'erreur —
 * sans jamais toucher un vrai Supabase (fetch mocké). Ne prétend pas
 * valider le contrat contre une instance Supabase réelle : voir
 * `docs/mobile/lot1-final-report.md`.
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

describe("createAnalysis", () => {
  it("envoie POST /api/v1/analyses avec l'en-tête Authorization et le corps JSON validé", async () => {
    mockFetchOnce(202, { id: "22222222-2222-2222-2222-222222222222", status: "pending", result: null });

    await createAnalysis(ACCESS_TOKEN, {
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

  it("rejette localement (Zod) une requête invalide avant tout appel réseau", async () => {
    globalThis.fetch = jest.fn();

    await expect(
      createAnalysis(ACCESS_TOKEN, {
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
      }),
    ).rejects.toThrow();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("propage une erreur structurée (code + message) quand le serveur répond une erreur", async () => {
    mockFetchOnce(429, { error: { code: "RATE_LIMITED", message: "Trop de requêtes." } });

    await expect(
      createAnalysis(ACCESS_TOKEN, {
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
      }),
    ).rejects.toMatchObject(new AnalysesApiError("RATE_LIMITED", "Trop de requêtes."));
  });
});

describe("getAnalysis", () => {
  it("envoie GET /api/v1/analyses/:id avec l'en-tête Authorization", async () => {
    const analysisId = "22222222-2222-2222-2222-222222222222";
    mockFetchOnce(200, { id: analysisId, status: "completed", result: null });

    await getAnalysis(ACCESS_TOKEN, analysisId);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain(`/api/v1/analyses/${analysisId}`);
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });
});
