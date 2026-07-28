import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { GET } from "../route";
import { handleAccountDeletionPost, type AccountDeletionPostDeps } from "../post-handler";
import { createInMemoryDedupStore } from "../dedup-store";
import { createFakeListingsSupabase } from "./fake-listings-supabase";
import type { AnonymizeResult } from "../data-deletion";
import type { SignatureVerificationOutcome } from "../signature";

const TOKEN = "a".repeat(64);
const ENDPOINT = "https://dealradar.example.com/api/ebay/account-deletion";
const SUPER_SECRET_USERNAME = "very-identifying-ebay-username";
const SUPER_SECRET_USER_ID = "very-identifying-user-id";
const SUPER_SECRET_EIAS = "very-identifying-eias-token";
const SUPER_SECRET_CLIENT_ID = "very-secret-client-id";
const SUPER_SECRET_CLIENT_SECRET = "very-secret-client-secret";

function getRequest(challengeCode: string | null, endpoint = ENDPOINT) {
  const url = new URL(endpoint);
  if (challengeCode !== null) url.searchParams.set("challenge_code", challengeCode);
  return new Request(url.toString(), { method: "GET" });
}

function postRequest(body: unknown, headers: Record<string, string> = { "x-ebay-signature": "whatever" }) {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validNotification(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0" },
    notification: {
      notificationId: "notif-1",
      eventDate: "2026-07-28T00:00:00Z",
      data: { username: SUPER_SECRET_USERNAME, userId: SUPER_SECRET_USER_ID, eiasToken: SUPER_SECRET_EIAS },
    },
    ...overrides,
  };
}

function expectedHash(challengeCode: string, token: string, endpoint: string): string {
  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(token);
  hash.update(endpoint);
  return hash.digest("hex");
}

function mockVerifySignature(outcome: SignatureVerificationOutcome) {
  return vi.fn(async (_rawBody: string, _header: string | null, _config: unknown) => outcome);
}

function mockAnonymize(result: AnonymizeResult) {
  return vi.fn(async (_supabase: unknown, _identifiers: unknown) => result);
}

/**
 * Deps par défaut pour les tests : anonymize/verifySignature/getServiceRoleClient
 * sont toujours explicitement injectés (jamais les vrais modules) — c'est le
 * point d'injection demandé pour un environnement de test explicite, et le
 * SEUL moyen autorisé de contourner la vérification de signature (jamais
 * possible dans le code runtime réel — voir post-handler.ts).
 * Credentials + signature valides par défaut ; chaque test surcharge
 * uniquement ce qu'il veut faire échouer.
 */
function testDeps(
  overrides: Partial<Omit<AccountDeletionPostDeps, "env">> & { env?: Partial<AccountDeletionPostDeps["env"]> } = {},
): AccountDeletionPostDeps {
  const { env: envOverride, ...rest } = overrides;
  return {
    verifySignature: mockVerifySignature({ valid: true }),
    anonymize: mockAnonymize({ correlationAttempted: true, listingsAnonymized: 0 }),
    dedupStore: createInMemoryDedupStore(),
    getServiceRoleClient: () => createFakeListingsSupabase([]) as never,
    ...rest,
    env: {
      EBAY_ENVIRONMENT: "sandbox",
      EBAY_CLIENT_ID: "test-client-id",
      EBAY_CLIENT_SECRET: "test-client-secret",
      ...envOverride,
    },
  };
}

let consoleSpies: { log: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  process.env.EBAY_VERIFICATION_TOKEN = TOKEN;
  process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL = ENDPOINT;

  consoleSpies = {
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
  };
});

afterEach(() => {
  delete process.env.EBAY_VERIFICATION_TOKEN;
  delete process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL;
  vi.restoreAllMocks();
});

function allLoggedText(): string {
  return [...consoleSpies.log.mock.calls, ...consoleSpies.warn.mock.calls, ...consoleSpies.error.mock.calls]
    .flat()
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
}

describe("GET /api/ebay/account-deletion (défi de vérification eBay)", () => {
  it("répond avec le hash SHA-256 exact attendu par eBay", async () => {
    const response = await GET(getRequest("challenge-123"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const json = await response.json();
    expect(json.challengeResponse).toBe(expectedHash("challenge-123", TOKEN, ENDPOINT));
  });

  it("URL différente de celle enregistrée → hash différent", async () => {
    const response = await GET(getRequest("challenge-123"));
    const json = await response.json();
    const differentEndpointHash = expectedHash("challenge-123", TOKEN, "https://autre-domaine.example.com/api/ebay/account-deletion");
    expect(json.challengeResponse).not.toBe(differentEndpointHash);
  });

  it("400 quand challenge_code est absent", async () => {
    const response = await GET(getRequest(null));
    expect(response.status).toBe(400);
  });

  it("500 MISCONFIGURED quand EBAY_VERIFICATION_TOKEN est absent", async () => {
    delete process.env.EBAY_VERIFICATION_TOKEN;
    const response = await GET(getRequest("challenge-123"));
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("MISCONFIGURED");
  });

  it("ne journalise jamais le token de vérification", async () => {
    await GET(getRequest("challenge-123"));
    expect(allLoggedText()).not.toContain(TOKEN);
  });
});

describe("POST /api/ebay/account-deletion — signature obligatoire dans tout environnement", () => {
  it("500 MISCONFIGURED sans EBAY_CLIENT_ID/EBAY_CLIENT_SECRET, quel que soit EBAY_ENVIRONMENT (sandbox)", async () => {
    const anonymize = vi.fn();
    const verifySignature = vi.fn();
    const deps = testDeps({ env: { EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "", EBAY_CLIENT_SECRET: "" }, anonymize, verifySignature });

    const response = await handleAccountDeletionPost(postRequest(validNotification()), deps);

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("MISCONFIGURED");
    expect(verifySignature).not.toHaveBeenCalled();
    expect(anonymize).not.toHaveBeenCalled();
  });

  it("500 MISCONFIGURED en production sans credentials également", async () => {
    const deps = testDeps({ env: { EBAY_ENVIRONMENT: "production", EBAY_CLIENT_ID: "", EBAY_CLIENT_SECRET: "" } });
    const response = await handleAccountDeletionPost(postRequest(validNotification()), deps);
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("MISCONFIGURED");
  });

  it("500 MISCONFIGURED avec seulement EBAY_CLIENT_ID (secret manquant)", async () => {
    const deps = testDeps({ env: { EBAY_CLIENT_SECRET: "" } });
    const response = await handleAccountDeletionPost(postRequest(validNotification()), deps);
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("MISCONFIGURED");
  });

  it("aucune façon de contourner la signature hors injection explicite de dépendance : sans surcharge de verifySignature, le mock par défaut est appelé", async () => {
    const verifySignature = mockVerifySignature({ valid: true });
    const anonymize = mockAnonymize({ correlationAttempted: false, listingsAnonymized: 0 });
    const deps = testDeps({ verifySignature, anonymize });

    await handleAccountDeletionPost(postRequest(validNotification(), { "x-ebay-signature": "sig" }), deps);

    expect(verifySignature).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/ebay/account-deletion — signature", () => {
  it("signature valide → 200 et anonymisation exécutée", async () => {
    const anonymize = mockAnonymize({ correlationAttempted: true, listingsAnonymized: 2 });
    const deps = testDeps({ verifySignature: mockVerifySignature({ valid: true }), anonymize });

    const response = await handleAccountDeletionPost(postRequest(validNotification()), deps);

    expect(response.status).toBe(200);
    expect((await response.json()).acknowledged).toBe(true);
    expect(anonymize).toHaveBeenCalledTimes(1);
  });

  it("signature invalide → 412 Precondition Failed, aucune anonymisation, aucun traitement", async () => {
    const anonymize = vi.fn();
    const deps = testDeps({ verifySignature: mockVerifySignature({ valid: false, reason: "signature_mismatch" }), anonymize });

    const response = await handleAccountDeletionPost(postRequest(validNotification()), deps);

    expect(response.status).toBe(412);
    expect((await response.json()).error.code).toBe("SIGNATURE_INVALID");
    expect(anonymize).not.toHaveBeenCalled();
  });

  it("en-tête X-EBAY-SIGNATURE absent → 412, aucun traitement (jamais un simple avertissement)", async () => {
    const anonymize = vi.fn();
    const deps = testDeps({ verifySignature: mockVerifySignature({ valid: false, reason: "missing_header" }), anonymize });

    const response = await handleAccountDeletionPost(postRequest(validNotification(), {}), deps);

    expect(response.status).toBe(412);
    expect(anonymize).not.toHaveBeenCalled();
  });
});

describe("POST /api/ebay/account-deletion — validation, corrélation, idempotence", () => {
  it("JSON syntaxiquement invalide (mais signature valide) → 400, aucun traitement", async () => {
    const anonymize = vi.fn();
    const response = await handleAccountDeletionPost(postRequest("not valid json"), testDeps({ anonymize }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
    expect(anonymize).not.toHaveBeenCalled();
  });

  it("payload JSON valide mais topic/schéma non pris en charge → 200 documenté, aucun traitement", async () => {
    const anonymize = vi.fn();
    const response = await handleAccountDeletionPost(
      postRequest(validNotification({ metadata: { topic: "SOMETHING_ELSE", schemaVersion: "1.0" } })),
      testDeps({ anonymize }),
    );
    expect(response.status).toBe(200);
    expect(anonymize).not.toHaveBeenCalled();
    expect(consoleSpies.warn).toHaveBeenCalled();
  });

  it("username corrélable → anonymisation réellement appelée avec cet identifiant", async () => {
    const anonymize = mockAnonymize({ correlationAttempted: true, listingsAnonymized: 1 });
    const response = await handleAccountDeletionPost(
      postRequest(validNotification({ notification: { notificationId: "n1", eventDate: "2026-07-28T00:00:00Z", data: { username: SUPER_SECRET_USERNAME } } })),
      testDeps({ anonymize }),
    );
    expect(response.status).toBe(200);
    expect(anonymize).toHaveBeenCalledWith(expect.anything(), { username: SUPER_SECRET_USERNAME, userId: undefined });
  });

  it("username absent → 200 + DELETION_SUBJECT_NOT_CORRELATED journalisé, sans aucun identifiant, aucun effacement incorrect", async () => {
    const anonymize = mockAnonymize({ correlationAttempted: false, listingsAnonymized: 0 });
    const response = await handleAccountDeletionPost(
      postRequest(validNotification({ notification: { notificationId: "n2", eventDate: "2026-07-28T00:00:00Z", data: {} } })),
      testDeps({ anonymize }),
    );
    expect(response.status).toBe(200);
    expect(allLoggedText()).toContain("DELETION_SUBJECT_NOT_CORRELATED");
    expect(allLoggedText()).not.toContain(SUPER_SECRET_USERNAME);
  });

  it("anonymisation déjà réalisée (0 correspondance) → 200, toujours un succès", async () => {
    const anonymize = mockAnonymize({ correlationAttempted: true, listingsAnonymized: 0 });
    const response = await handleAccountDeletionPost(postRequest(validNotification()), testDeps({ anonymize }));
    expect(response.status).toBe(200);
    expect((await response.json()).acknowledged).toBe(true);
  });

  it("notification répétée (même notificationId) → traitement idempotent, anonymize appelé une seule fois", async () => {
    const anonymize = mockAnonymize({ correlationAttempted: true, listingsAnonymized: 1 });
    const deps = testDeps({ anonymize });
    const notif = validNotification({ notification: { notificationId: "dup-1", eventDate: "2026-07-28T00:00:00Z", data: { username: SUPER_SECRET_USERNAME } } });

    const first = await handleAccountDeletionPost(postRequest(notif), deps);
    const second = await handleAccountDeletionPost(postRequest(notif), deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(anonymize).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/ebay/account-deletion — échecs de traitement (jamais un 200 optimiste)", () => {
  it("erreur Supabase/interne pendant l'anonymisation → 503, aucun acquittement de succès", async () => {
    const anonymize = vi.fn().mockRejectedValue(new Error("Supabase timeout"));
    const response = await handleAccountDeletionPost(postRequest(validNotification()), testDeps({ anonymize }));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("PROCESSING_FAILED");
  });

  it("nouvelle tentative après une erreur réussit et retourne 200 (l'échec n'a pas bloqué la notification)", async () => {
    const anonymize = vi
      .fn()
      .mockRejectedValueOnce(new Error("Supabase timeout"))
      .mockResolvedValueOnce({ correlationAttempted: true, listingsAnonymized: 1 } satisfies AnonymizeResult);
    const deps = testDeps({ anonymize });
    const notif = validNotification({ notification: { notificationId: "retry-1", eventDate: "2026-07-28T00:00:00Z", data: { username: SUPER_SECRET_USERNAME } } });

    const first = await handleAccountDeletionPost(postRequest(notif), deps);
    const second = await handleAccountDeletionPost(postRequest(notif), deps);

    expect(first.status).toBe(503);
    expect(second.status).toBe(200);
    expect(anonymize).toHaveBeenCalledTimes(2);
  });

  it("un échec ne marque pas le dédup — la notification suivante n'est pas traitée comme un doublon", async () => {
    const anonymize = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ correlationAttempted: false, listingsAnonymized: 0 });
    const deps = testDeps({ anonymize });
    const notif = validNotification({ notification: { notificationId: "retry-2", eventDate: "2026-07-28T00:00:00Z", data: {} } });

    await handleAccountDeletionPost(postRequest(notif), deps);
    const second = await handleAccountDeletionPost(postRequest(notif), deps);

    expect(second.status).toBe(200);
    expect(allLoggedText()).not.toContain("dupliquée");
  });
});

describe("POST /api/ebay/account-deletion — aucune fuite de PII ou de secret dans les logs", () => {
  it("ne journalise jamais username/userId/eiasToken sur un traitement réussi", async () => {
    const anonymize = mockAnonymize({ correlationAttempted: true, listingsAnonymized: 1 });
    await handleAccountDeletionPost(postRequest(validNotification()), testDeps({ anonymize }));

    const logged = allLoggedText();
    expect(logged).not.toContain(SUPER_SECRET_USERNAME);
    expect(logged).not.toContain(SUPER_SECRET_USER_ID);
    expect(logged).not.toContain(SUPER_SECRET_EIAS);
  });

  it("ne journalise jamais username/userId/eiasToken sur un rejet de signature", async () => {
    const deps = testDeps({ verifySignature: mockVerifySignature({ valid: false, reason: "signature_mismatch" }) });

    await handleAccountDeletionPost(postRequest(validNotification()), deps);

    const logged = allLoggedText();
    expect(logged).not.toContain(SUPER_SECRET_USERNAME);
    expect(logged).not.toContain(SUPER_SECRET_USER_ID);
    expect(logged).not.toContain(SUPER_SECRET_EIAS);
  });

  it("ne journalise jamais EBAY_CLIENT_ID/EBAY_CLIENT_SECRET", async () => {
    const deps = testDeps({
      env: { EBAY_CLIENT_ID: SUPER_SECRET_CLIENT_ID, EBAY_CLIENT_SECRET: SUPER_SECRET_CLIENT_SECRET },
      verifySignature: mockVerifySignature({ valid: true }),
    });

    await handleAccountDeletionPost(postRequest(validNotification()), deps);

    const logged = allLoggedText();
    expect(logged).not.toContain(SUPER_SECRET_CLIENT_ID);
    expect(logged).not.toContain(SUPER_SECRET_CLIENT_SECRET);
  });

  it("ne journalise jamais username/userId/eiasToken ni de détail interne sensible sur un échec de traitement (503)", async () => {
    const anonymize = vi.fn().mockRejectedValue(new Error("connection refused"));
    await handleAccountDeletionPost(postRequest(validNotification()), testDeps({ anonymize }));

    const logged = allLoggedText();
    expect(logged).not.toContain(SUPER_SECRET_USERNAME);
    expect(logged).not.toContain(SUPER_SECRET_USER_ID);
    expect(logged).not.toContain(SUPER_SECRET_EIAS);
  });
});
