import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/route-auth", () => ({ authenticateBearerRequest: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@dealradar/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dealradar/ingestion")>()),
  getOperatorObservabilitySummary: vi.fn(),
  checkHistoricalEngineAvailability: vi.fn(),
}));

import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getOperatorObservabilitySummary, checkHistoricalEngineAvailability } from "@dealradar/ingestion";
import { GET } from "../route";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function getRequest(query = "", headers: Record<string, string> = { authorization: "Bearer valid-token" }) {
  return new Request(`http://localhost/api/internal/operator/observability${query}`, { method: "GET", headers });
}

const emptySummary = {
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

const emptyHistoricalEngine = { allTablesAvailable: true, tables: [] };

beforeEach(() => {
  vi.mocked(authenticateBearerRequest).mockReset();
  vi.mocked(createServiceRoleClient).mockReset().mockReturnValue({} as never);
  vi.mocked(getOperatorObservabilitySummary).mockReset().mockResolvedValue(emptySummary as never);
  vi.mocked(checkHistoricalEngineAvailability).mockReset().mockResolvedValue(emptyHistoricalEngine as never);
});

describe("GET /api/internal/operator/observability", () => {
  it("401 quand le jeton est manquant/invalide", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue(null);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(getOperatorObservabilitySummary).not.toHaveBeenCalled();
  });

  it("401 sans en-tête Authorization du tout — jamais un accès anonyme même en lecture seule", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue(null);

    const response = await GET(getRequest("", {}));

    expect(response.status).toBe(401);
  });

  it("200 : combine summary + historicalEngine, jamais de secret/URL authentifiée dans la réponse", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(getOperatorObservabilitySummary).mockResolvedValue({
      ...emptySummary,
      dueTargetCount: 3,
      overdueTargetCount: 1,
      sourceReadiness: [{ source: "ebay", readiness: "ready" }],
    } as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.summary.dueTargetCount).toBe(3);
    expect(json.summary.overdueTargetCount).toBe(1);
    expect(json.summary.sourceReadiness).toEqual([{ source: "ebay", readiness: "ready" }]);
    expect(json.historicalEngine.allTablesAvailable).toBe(true);
    expect(JSON.stringify(json)).not.toMatch(/api[_-]?key|secret|token|bearer/i);
  });

  it("recentRunLimit borné à 50 même si un client demande plus — jamais une requête non bornée", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    await GET(getRequest("?recentRunLimit=9999"));

    expect(getOperatorObservabilitySummary).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recentRunLimit: 50 }));
  });

  it("recentRunLimit absent/invalide : transmis comme undefined, la fonction applique son propre défaut", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    await GET(getRequest("?recentRunLimit=not-a-number"));

    expect(getOperatorObservabilitySummary).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recentRunLimit: undefined }));
  });

  it("sourceReadiness calculé pour CHAQUE source de la matrice, jamais une source oubliée", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    await GET(getRequest());

    const callArgs = vi.mocked(getOperatorObservabilitySummary).mock.calls[0]![1] as { sourceReadiness: { source: string; readiness: string }[] };
    expect(callArgs.sourceReadiness.length).toBeGreaterThan(0);
    expect(callArgs.sourceReadiness.every((r) => typeof r.source === "string" && typeof r.readiness === "string")).toBe(true);
  });

  it("exception inattendue : 500 générique, jamais la pile/le message brut exposé au client", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(getOperatorObservabilitySummary).mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432 — détail interne jamais destiné au client"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error.code).toBe("INTERNAL");
    expect(json.error.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
