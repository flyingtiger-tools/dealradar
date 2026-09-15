import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/route-auth", () => ({ authenticateBearerRequest: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/tcg-ai-provider-config", () => ({ buildTcgAiExtractionConfig: vi.fn() }));
vi.mock("@/lib/tcg-connector-config", () => ({ buildTcgPipelineConnectorsFromEnv: vi.fn() }));
vi.mock("@dealradar/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dealradar/ingestion")>()),
  processTcgCardAnalysis: vi.fn(),
}));

import { authenticateBearerRequest } from "@/lib/supabase/route-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildTcgAiExtractionConfig } from "@/lib/tcg-ai-provider-config";
import { buildTcgPipelineConnectorsFromEnv } from "@/lib/tcg-connector-config";
import { processTcgCardAnalysis } from "@dealradar/ingestion";
import { POST } from "../route";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function postRequest(body: unknown, headers: Record<string, string> = { authorization: "Bearer valid-token" }) {
  return new Request("http://localhost/api/internal/tcg/analyze", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const identifiedWithPriceResult = {
  kind: "pokemon_tcg_card" as const,
  needsConfirmation: false,
  extractedFields: {
    category: "pokemon_tcg" as const,
    game: "pokemon",
    cardName: "Pikachu",
    setName: "Base Set",
    cardNumber: "58",
    variant: "Normal",
    language: "English",
    productKind: "raw_card" as const,
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
    variant: "Normal",
    language: "English",
    productKind: "raw_card",
    gradingCompany: null,
    grade: null,
    confidence: 1,
    catalogCorroboration: "corroborated" as const,
  },
  priceObservations: [
    {
      source: "tcgdex",
      provenance: "tcgdex-cardmarket",
      amountCents: 963,
      currency: "EUR",
      condition: null,
      variant: "Normal",
      language: "English",
      gradingCompany: null,
      grade: null,
      region: "EU",
      updatedAt: "2026-09-15T00:00:00.000Z",
      conversion: null,
      warnings: [],
    },
  ],
  warnings: [],
  reason: null,
};

beforeEach(() => {
  vi.mocked(authenticateBearerRequest).mockReset();
  vi.mocked(createServiceRoleClient).mockReset().mockReturnValue({} as never);
  vi.mocked(buildTcgAiExtractionConfig).mockReset().mockReturnValue(undefined);
  vi.mocked(buildTcgPipelineConnectorsFromEnv).mockReset().mockReturnValue({} as never);
  vi.mocked(processTcgCardAnalysis).mockReset();
});

describe("POST /api/internal/tcg/analyze", () => {
  it("401 quand le jeton est manquant/invalide", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue(null);

    const response = await POST(postRequest({ imageUrl: "https://x.supabase.co/storage/v1/object/analysis-uploads/u1/photo.jpg" }));

    expect(response.status).toBe(401);
    expect(processTcgCardAnalysis).not.toHaveBeenCalled();
  });

  it("400 quand ni imageUrl ni providedTcgHints ne sont fournis", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("INVALID_REQUEST");
  });

  it("413 quand le corps dépasse la taille maximale", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    const response = await POST(postRequest("x".repeat(30_000)));

    expect(response.status).toBe(413);
  });

  it("422 quand imageUrl référence un stockage hors du préfixe propriétaire (SSRF)", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });

    const response = await POST(postRequest({ imageUrl: "https://evil.example.com/analysis-uploads/other-user/x.jpg" }));

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error.code).toBe("UNSUPPORTED_IMAGE");
    expect(processTcgCardAnalysis).not.toHaveBeenCalled();
  });

  it("identifiée avec prix : 200, status completed, identity et priceObservations présents (mapping mobile direct)", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(processTcgCardAnalysis).mockResolvedValue({ status: "completed", result: identifiedWithPriceResult });

    const response = await POST(postRequest({ imageUrl: `https://x.supabase.co/storage/v1/object/analysis-uploads/${USER_ID}/photo.jpg` }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("completed");
    expect(json.result.identity.name).toBe("Pikachu");
    expect(json.result.priceObservations).toHaveLength(1);
    expect(json.result.priceObservations[0].amountCents).toBe(963);
  });

  it("identifiée sans prix : 200, status insufficient_data MAIS identity renseignée — jamais un échec total quand seul le prix manque", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(processTcgCardAnalysis).mockResolvedValue({
      status: "insufficient_data",
      result: { ...identifiedWithPriceResult, priceObservations: [], reason: null },
    });

    const response = await POST(postRequest({ imageUrl: `https://x.supabase.co/storage/v1/object/analysis-uploads/${USER_ID}/photo.jpg` }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("insufficient_data");
    expect(json.result.identity).not.toBeNull();
    expect(json.result.identity.name).toBe("Pikachu");
    expect(json.result.priceObservations).toEqual([]);
  });

  it("saisie manuelle (providedTcgHints, sans photo) : imageReferences vide transmis à processTcgCardAnalysis", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(processTcgCardAnalysis).mockResolvedValue({ status: "completed", result: identifiedWithPriceResult });

    const hints = {
      cardName: "Pikachu",
      setName: "Base Set",
      cardNumber: "58",
      variant: null,
      language: null,
      productKind: null,
      gradingCompany: null,
      grade: null,
    };
    const response = await POST(postRequest({ providedTcgHints: hints }));

    expect(response.status).toBe(200);
    expect(processTcgCardAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageReferences: [], providedTcgHints: hints }),
      expect.anything(),
    );
  });

  it("provider IA indisponible (buildTcgAiExtractionConfig retourne undefined) : pipeline tourne quand même via providedTcgHints, jamais un crash", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(buildTcgAiExtractionConfig).mockReturnValue(undefined);
    vi.mocked(processTcgCardAnalysis).mockResolvedValue({
      status: "failed",
      result: { ...identifiedWithPriceResult, identity: null, priceObservations: [], reason: "Extraction visuelle non configurée (IA absente)." },
    });

    const response = await POST(postRequest({ imageUrl: `https://x.supabase.co/storage/v1/object/analysis-uploads/${USER_ID}/photo.jpg` }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("failed");
    expect(processTcgCardAnalysis).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ extractionOptions: undefined }));
  });

  it("exception inattendue du pipeline (LOT beta product readiness, Phase 37/41) : 500 générique, jamais la pile/le message brut exposé au client", async () => {
    vi.mocked(authenticateBearerRequest).mockResolvedValue({ userId: USER_ID });
    vi.mocked(processTcgCardAnalysis).mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432 — détail interne jamais destiné au client"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(postRequest({ imageUrl: `https://x.supabase.co/storage/v1/object/analysis-uploads/${USER_ID}/photo.jpg` }));

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error.code).toBe("INTERNAL");
    expect(json.error.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    // L'exception réelle est bien journalisée côté serveur (pas silencieusement avalée), jamais renvoyée au client.
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
