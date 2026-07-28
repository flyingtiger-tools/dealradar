import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeServiceRoleClient } from "../../__tests__/fake-service-role-client";

vi.mock("@/lib/supabase/route-auth", () => ({ authenticateBearerRequest: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { GET } from "../route";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "99999999-9999-9999-9999-999999999999";
const ANALYSIS_ID = "33333333-3333-3333-3333-333333333333";

function getRequest() {
  return new Request(`http://localhost/api/v1/analyses/${ANALYSIS_ID}`, {
    headers: { authorization: "Bearer valid-token" },
  });
}

beforeEach(() => {
  vi.mocked(authenticateBearerRequest).mockReset();
  vi.mocked(createServiceRoleClient).mockReset();
});

describe("GET /v1/analyses/:id", () => {
  it("401 quand le jeton est manquant/invalide", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue(null);

    const response = await GET(getRequest(), { params: Promise.resolve({ id: ANALYSIS_ID }) });

    expect(response.status).toBe(401);
  });

  it("404 (jamais 403) pour l'analyse d'un autre utilisateur", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: OTHER_USER_ID });
    vi.mocked(createServiceRoleClient).mockReturnValue(
      createFakeServiceRoleClient({
        onSelect: () => ({ data: { id: ANALYSIS_ID, user_id: OWNER_ID, status: "completed", result: {} }, error: null }),
      }) as never,
    );

    const response = await GET(getRequest(), { params: Promise.resolve({ id: ANALYSIS_ID }) });

    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("404 quand l'analyse n'existe pas", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: OWNER_ID });
    vi.mocked(createServiceRoleClient).mockReturnValue(
      createFakeServiceRoleClient({ onSelect: () => ({ data: null, error: null }) }) as never,
    );

    const response = await GET(getRequest(), { params: Promise.resolve({ id: ANALYSIS_ID }) });

    expect(response.status).toBe(404);
  });

  it("200 avec le statut/résultat pour le propriétaire", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: OWNER_ID });
    vi.mocked(createServiceRoleClient).mockReturnValue(
      createFakeServiceRoleClient({
        onSelect: () => ({
          data: { id: ANALYSIS_ID, user_id: OWNER_ID, status: "completed", result: { decision: "REVIEW" } },
          error: null,
        }),
      }) as never,
    );

    const response = await GET(getRequest(), { params: Promise.resolve({ id: ANALYSIS_ID }) });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ id: ANALYSIS_ID, status: "completed", result: { decision: "REVIEW" } });
  });
});
