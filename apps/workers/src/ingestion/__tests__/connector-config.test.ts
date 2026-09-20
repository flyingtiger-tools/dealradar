import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { tryBuildEbayConnectorFromEnv } from "../connector-config";

const ENV_KEYS = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_MARKETPLACE_ID", "EBAY_ENVIRONMENT"] as const;

function clearEbayEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("tryBuildEbayConnectorFromEnv", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
    clearEbayEnv();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("retourne null (jamais une exception) quand la configuration eBay est absente — dégradation gracieuse", () => {
    expect(tryBuildEbayConnectorFromEnv()).toBeNull();
  });

  it("retourne null quand seule une partie de la configuration est posée", () => {
    process.env.EBAY_CLIENT_ID = "id";
    process.env.EBAY_CLIENT_SECRET = "secret";
    // EBAY_MARKETPLACE_ID / EBAY_ENVIRONMENT manquants.
    expect(tryBuildEbayConnectorFromEnv()).toBeNull();
  });

  it("construit un connecteur réel quand la configuration complète est présente", () => {
    process.env.EBAY_CLIENT_ID = "id";
    process.env.EBAY_CLIENT_SECRET = "secret";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_CH";
    process.env.EBAY_ENVIRONMENT = "sandbox";
    const connector = tryBuildEbayConnectorFromEnv();
    expect(connector).not.toBeNull();
    expect(connector!.source).toBe("ebay");
    expect(connector!.capabilities).toContain("search");
  });
});
