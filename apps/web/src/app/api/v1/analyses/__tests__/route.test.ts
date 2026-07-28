import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeServiceRoleClient } from "./fake-service-role-client";

vi.mock("@/lib/supabase/route-auth", () => ({ authenticateBearerRequest: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/pgboss", () => ({ enqueueJob: vi.fn() }));

import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { enqueueJob } from "@/lib/pgboss";
import { POST } from "../route";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_REQUEST_ID = "22222222-2222-2222-2222-222222222222";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    sourceType: "manual_entry",
    consentVersion: "1",
    clientRequestId: CLIENT_REQUEST_ID,
    ...overrides,
  };
}

function postRequest(body: unknown, headers: Record<string, string> = { authorization: "Bearer valid-token" }) {
  return new Request("http://localhost/api/v1/analyses", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(authenticateBearerRequest).mockReset();
  vi.mocked(createServiceRoleClient).mockReset();
  vi.mocked(enqueueJob).mockReset();
});

describe("POST /v1/analyses", () => {
  it("401 quand le jeton est manquant/invalide", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue(null);

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("400 quand le corps est invalide (clientRequestId manquant)", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    const response = await POST(postRequest({ sourceType: "manual_entry", consentVersion: "1" }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("INVALID_REQUEST");
  });

  it("413 quand le corps dépasse la taille maximale", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    const response = await POST(postRequest("x".repeat(60_000)));

    expect(response.status).toBe(413);
  });

  it("422 quand une image référence un stockage hors du préfixe propriétaire", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    const response = await POST(
      postRequest(validBody({ imageReferences: [{ url: "https://evil.example.com/analysis-uploads/other-user/x.jpg" }] })),
    );

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error.code).toBe("UNSUPPORTED_IMAGE");
  });

  it("429 avec Retry-After quand le rate limit est dépassé", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(createServiceRoleClient).mockReturnValue(
      createFakeServiceRoleClient({ rpc: () => ({ data: false, error: null }) }) as never,
    );

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(vi.mocked(enqueueJob)).not.toHaveBeenCalled();
  });

  it("crée l'analyse, enfile le job, répond 202 pending", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(createServiceRoleClient).mockReturnValue(
      createFakeServiceRoleClient({
        rpc: () => ({ data: true, error: null }),
        onInsert: () => ({ data: { id: "analysis-1", status: "pending" }, error: null }),
      }) as never,
    );

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(202);
    const json = await response.json();
    expect(json).toEqual({ id: "analysis-1", status: "pending" });
    expect(vi.mocked(enqueueJob)).toHaveBeenCalledWith("analysis.process", { analysisRequestId: "analysis-1" });
  });

  it("réémission réseau (même clientRequestId) : relit la ligne existante, n'enfile pas un second job", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(createServiceRoleClient).mockReturnValue(
      createFakeServiceRoleClient({
        rpc: () => ({ data: true, error: null }),
        onInsert: () => ({ data: null, error: { code: "23505", message: "duplicate key" } }),
        onSelect: () => ({ data: { id: "analysis-existing", status: "processing" }, error: null }),
      }) as never,
    );

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(202);
    const json = await response.json();
    expect(json).toEqual({ id: "analysis-existing", status: "processing" });
    expect(vi.mocked(enqueueJob)).not.toHaveBeenCalled();
  });
});
