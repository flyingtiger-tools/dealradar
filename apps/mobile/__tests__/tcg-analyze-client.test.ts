const mockGetCurrentAccessToken = jest.fn();

jest.mock("../src/auth/session", () => ({
  getCurrentAccessToken: () => mockGetCurrentAccessToken(),
}));

import { analyzeTcgCard, TcgAnalyzeError } from "../src/api/tcg-analyze-client";

/**
 * Client du pipeline TCG serverless synchrone (`POST /api/internal/tcg/
 * analyze`, lot "journée autonome") — même discipline que
 * `analyses-client.test.ts` : plomberie HTTP réelle vérifiée (fetch et
 * `auth/session` mockés), jamais un vrai réseau touché.
 */

const ACCESS_TOKEN = "test-access-token";

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

describe("analyzeTcgCard", () => {
  it("ni imageUrl ni providedTcgHints : rejette localement, jamais un appel réseau", async () => {
    globalThis.fetch = jest.fn();
    await expect(analyzeTcgCard({})).rejects.toThrow(TcgAnalyzeError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("aucune session active : rejette avant tout appel réseau", async () => {
    mockGetCurrentAccessToken.mockResolvedValue(null);
    globalThis.fetch = jest.fn();

    await expect(analyzeTcgCard({ imageUrl: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/photo.jpg" })).rejects.toThrow(
      TcgAnalyzeError,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("envoie POST /api/internal/tcg/analyze avec Authorization et le corps JSON (imageUrl)", async () => {
    mockFetchOnce(200, { status: "completed", result: { kind: "pokemon_tcg_card" } });

    await analyzeTcgCard({ imageUrl: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/photo.jpg" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/internal/tcg/analyze");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    const sentBody = JSON.parse(init.body);
    expect(sentBody.imageUrl).toBe("https://x.supabase.co/storage/v1/object/analysis-uploads/u1/photo.jpg");
  });

  it("envoie providedTcgHints tel quel (saisie manuelle, sans imageUrl)", async () => {
    mockFetchOnce(200, { status: "completed", result: { kind: "pokemon_tcg_card" } });
    const hints = { cardName: "Pikachu", setName: "Base Set", cardNumber: "58", variant: null, language: null, productKind: null, gradingCompany: null, grade: null };

    await analyzeTcgCard({ providedTcgHints: hints });

    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    const sentBody = JSON.parse(init.body);
    expect(sentBody.providedTcgHints).toEqual(hints);
    expect(sentBody.imageUrl).toBeUndefined();
  });

  it("retourne {status, result} directement — jamais de polling, un seul appel réseau", async () => {
    mockFetchOnce(200, {
      status: "completed",
      result: { kind: "pokemon_tcg_card", identity: { name: "Pikachu" }, priceObservations: [{ amountCents: 963 }] },
    });

    const response = await analyzeTcgCard({ imageUrl: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/photo.jpg" });

    expect(response.status).toBe("completed");
    expect(response.result.identity).toEqual({ name: "Pikachu" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("erreur HTTP : lève TcgAnalyzeError avec le code/message du corps d'erreur, jamais une exception brute non exploitable", async () => {
    mockFetchOnce(422, { error: { code: "UNSUPPORTED_IMAGE", message: "Référence d'image hors du stockage propriétaire." } });

    await expect(analyzeTcgCard({ imageUrl: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/photo.jpg" })).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE",
      message: "Référence d'image hors du stockage propriétaire.",
    });
  });
});
