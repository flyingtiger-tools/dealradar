import { describe, expect, it } from "vitest";
import { getDbIntegrationConfig } from "./env";

/** Tests TOUJOURS exécutés (jamais gated) — vérifient uniquement la logique PURE du garde-fou, sans jamais ouvrir de vraie connexion. */
describe("getDbIntegrationConfig", () => {
  it("renvoie null si ALLOW_DB_INTEGRATION_TESTS n'est pas exactement 'true'", () => {
    expect(getDbIntegrationConfig({})).toBeNull();
    expect(getDbIntegrationConfig({ ALLOW_DB_INTEGRATION_TESTS: "false" })).toBeNull();
    expect(getDbIntegrationConfig({ ALLOW_DB_INTEGRATION_TESTS: "1" })).toBeNull();
  });

  it("renvoie null si une des trois variables TEST_DATABASE_* manque, même avec l'opt-in posé", () => {
    expect(
      getDbIntegrationConfig({
        ALLOW_DB_INTEGRATION_TESTS: "true",
        TEST_DATABASE_URL: "postgresql://test",
        TEST_DATABASE_SUPABASE_URL: "https://test.supabase.co",
        // TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY manquante.
      }),
    ).toBeNull();
  });

  it("renvoie une config complète quand tout est présent", () => {
    const config = getDbIntegrationConfig({
      ALLOW_DB_INTEGRATION_TESTS: "true",
      TEST_DATABASE_URL: "postgresql://test",
      TEST_DATABASE_SUPABASE_URL: "https://test.supabase.co",
      TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY: "test-key",
    });
    expect(config).toEqual({
      postgresConnectionString: "postgresql://test",
      supabaseUrl: "https://test.supabase.co",
      supabaseServiceRoleKey: "test-key",
    });
  });

  it("refuse (lève) si TEST_DATABASE_SUPABASE_URL == SUPABASE_URL (Production) — jamais un test dirigé vers la Production", () => {
    expect(() =>
      getDbIntegrationConfig({
        ALLOW_DB_INTEGRATION_TESTS: "true",
        TEST_DATABASE_URL: "postgresql://test",
        TEST_DATABASE_SUPABASE_URL: "https://prod.supabase.co",
        TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY: "test-key",
        SUPABASE_URL: "https://prod.supabase.co",
      }),
    ).toThrow(/Production/);
  });

  it("refuse (lève) si TEST_DATABASE_URL == DATABASE_URL (Production)", () => {
    expect(() =>
      getDbIntegrationConfig({
        ALLOW_DB_INTEGRATION_TESTS: "true",
        TEST_DATABASE_URL: "postgresql://prod-host/db",
        TEST_DATABASE_SUPABASE_URL: "https://test.supabase.co",
        TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY: "test-key",
        DATABASE_URL: "postgresql://prod-host/db",
      }),
    ).toThrow(/Production/);
  });
});
