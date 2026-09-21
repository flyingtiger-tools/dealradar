import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeSupabase } from "../../jobs/__tests__/fake-supabase";

vi.mock("../../ingestion/market-source-factory", () => ({
  buildMarketSourcesFromEnv: vi.fn(() => ({
    sources: [],
    diagnostics: [
      { name: "ebay", enabled: true, readiness: "ready" },
      { name: "pricecharting", enabled: false, readiness: "license_required" },
    ],
  })),
}));

const { buildActivationPreflightReport } = await import("../activation-preflight");

const AI_ENV_KEYS = ["AI_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"] as const;
const DB_INTEGRATION_ENV_KEYS = ["ALLOW_DB_INTEGRATION_TESTS", "TEST_DATABASE_URL", "TEST_DATABASE_SUPABASE_URL", "TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY"] as const;

beforeEach(() => {
  for (const key of AI_ENV_KEYS) delete process.env[key];
  for (const key of DB_INTEGRATION_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of AI_ENV_KEYS) delete process.env[key];
  for (const key of DB_INTEGRATION_ENV_KEYS) delete process.env[key];
});

describe("buildActivationPreflightReport", () => {
  it("aucune base fournie (dbOverride null) : migrations/dueResearchTargets restent NOT_TESTED, jamais devinés", async () => {
    const report = await buildActivationPreflightReport(null);

    expect(report.subsystems.migrations.status).toBe("NOT_TESTED");
    expect(report.subsystems.migrations.tables).toBeNull();
    expect(report.subsystems.dueResearchTargets.status).toBe("NOT_TESTED");
    expect(report.subsystems.dueResearchTargets.count).toBeNull();
    expect(report.overall).toBe("PARTIAL");
  });

  it("base fournie, toutes les tables/colonnes disponibles : migrations READY", async () => {
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(report.subsystems.migrations.status).toBe("READY");
    expect(report.subsystems.migrations.categorySlugColumnAvailable).toBe(true);
    expect(report.subsystems.migrations.tables?.every((t) => t.available)).toBe(true);
  });

  it("une table historique manquante : migrations BLOCKED, overall BLOCKED", async () => {
    const db = new FakeSupabase();
    const originalFrom = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      if (table === "market_refresh_runs") {
        return {
          select: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "relation does not exist" } }) }),
        } as never;
      }
      return originalFrom(table);
    });

    const report = await buildActivationPreflightReport(db as never);

    expect(report.subsystems.migrations.status).toBe("BLOCKED");
    expect(report.overall).toBe("BLOCKED");
  });

  it("aucune valeur de credential jamais exposée dans le rapport, uniquement des statuts/noms de variable", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "super-secret-anthropic-key";
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(JSON.stringify(report)).not.toContain("super-secret-anthropic-key");
  });

  it("AI_PROVIDER absent : aiProvider NOT_CONFIGURED, jamais un blocage global pour ce seul motif", async () => {
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(report.subsystems.aiProvider.status).toBe("NOT_CONFIGURED");
    expect(report.subsystems.aiProvider.provider).toBeNull();
  });

  it("AI_PROVIDER défini mais clé absente : aiProvider MISCONFIGURED, overall BLOCKED", async () => {
    process.env.AI_PROVIDER = "anthropic";
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(report.subsystems.aiProvider.status).toBe("MISCONFIGURED");
    expect(report.subsystems.aiProvider.expectedKeyVar).toBe("ANTHROPIC_API_KEY");
    expect(report.subsystems.aiProvider.keyPresent).toBe(false);
    expect(report.overall).toBe("BLOCKED");
  });

  it("AI_PROVIDER défini avec sa clé présente : aiProvider READY", async () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "k";
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(report.subsystems.aiProvider.status).toBe("READY");
  });

  it("variables d'intégration DB absentes : dbIntegrationTests NOT_CONFIGURED, jamais un blocage global", async () => {
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(report.subsystems.dbIntegrationTests.status).toBe("NOT_CONFIGURED");
    expect(report.overall).not.toBe("BLOCKED");
  });

  it("les 4 variables d'intégration DB présentes : dbIntegrationTests READY", async () => {
    process.env.ALLOW_DB_INTEGRATION_TESTS = "true";
    process.env.TEST_DATABASE_URL = "postgres://test";
    process.env.TEST_DATABASE_SUPABASE_URL = "https://test.supabase.co";
    process.env.TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY = "k";
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(report.subsystems.dbIntegrationTests.status).toBe("READY");
  });

  it("sourceReadiness reflète buildMarketSourcesFromEnv().diagnostics tel quel, jamais recalculé", async () => {
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(report.subsystems.sourceReadiness.sources).toEqual([
      { source: "ebay", readiness: "ready" },
      { source: "pricecharting", readiness: "license_required" },
    ]);
  });

  it("Railway/le scheduler ne sont jamais requis pour ce préflight (aucune dépendance réseau au worker) — reflété dans les notes", async () => {
    const db = new FakeSupabase();

    const report = await buildActivationPreflightReport(db as never);

    expect(report.notes.some((n) => n.toLowerCase().includes("railway"))).toBe(true);
  });
});
