import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/route-auth", () => ({ authenticateBearerRequest: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@dealradar/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dealradar/ingestion")>()),
  queryProductHistory: vi.fn(),
}));

import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { queryProductHistory } from "@dealradar/ingestion";
import { GET } from "../route";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function getRequest(query = "", headers: Record<string, string> = { authorization: "Bearer valid-token" }) {
  return new Request(`http://localhost/api/internal/operator/product-history${query}`, { method: "GET", headers });
}

const emptyHistory = {
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
    volatility: null,
    liquidityProxy: null,
    activeSupplyCount: 0,
    sourceDiversityOverTime: 0,
    historicalPercentilePosition: null,
    priceNowVsHistory: null,
    confidence: 0,
    reasons: ["Aucun point d'historique disponible."],
  },
  activeSupplyCount: 0,
  sourceDiversity: 0,
  freshnessHours: null,
};

beforeEach(() => {
  vi.mocked(authenticateBearerRequest).mockReset();
  vi.mocked(createServiceRoleClient).mockReset().mockReturnValue({} as never);
  vi.mocked(queryProductHistory).mockReset().mockResolvedValue(emptyHistory as never);
});

describe("GET /api/internal/operator/product-history", () => {
  it("401 quand le jeton est manquant/invalide", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue(null);

    const response = await GET(getRequest("?productKey=lego:10300"));

    expect(response.status).toBe(401);
    expect(queryProductHistory).not.toHaveBeenCalled();
  });

  it("400 quand productKey est absent", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("INVALID_REQUEST");
    expect(queryProductHistory).not.toHaveBeenCalled();
  });

  it("200 : lit l'historique du productKey demandé, aucune recommandation/prédiction dans la réponse", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    const response = await GET(getRequest("?productKey=lego:10300"));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.history.productKey).toBe("lego:10300");
    expect(queryProductHistory).toHaveBeenCalledWith(expect.anything(), "lego:10300", expect.anything());
    expect(JSON.stringify(json)).not.toMatch(/predict|recommendation|decision/i);
  });

  it("recentSummaryLimit/lookbackDays bornés même si un client demande plus", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    await GET(getRequest("?productKey=lego:10300&recentSummaryLimit=9999&lookbackDays=99999"));

    expect(queryProductHistory).toHaveBeenCalledWith(expect.anything(), "lego:10300", { recentSummaryLimit: 50, lookbackDays: 730 });
  });

  it("exception inattendue : 500 générique, jamais la pile/le message brut exposé au client", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(queryProductHistory).mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432 — détail interne jamais destiné au client"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(getRequest("?productKey=lego:10300"));

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error.code).toBe("INTERNAL");
    expect(json.error.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
