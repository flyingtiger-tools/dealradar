import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildMarketSourcesFromEnv } from "../market-source-factory";

const ALL_ENV_KEYS = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_MARKETPLACE_ID",
  "EBAY_ENVIRONMENT",
  "SERPAPI_KEY",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "DATAFORSEO_LOCATION_CODE",
  "BRICKLINK_CONSUMER_KEY",
  "BRICKLINK_CONSUMER_SECRET",
  "BRICKLINK_TOKEN_VALUE",
  "BRICKLINK_TOKEN_SECRET",
  "PRICECHARTING_TOKEN",
  "KEEPA_API_KEY",
  "ZYTE_API_KEY",
] as const;

function clearAllEnv() {
  for (const key of ALL_ENV_KEYS) delete process.env[key];
}

describe("buildMarketSourcesFromEnv", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ALL_ENV_KEYS) original[key] = process.env[key];
    clearAllEnv();
  });

  afterEach(() => {
    for (const key of ALL_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("aucune credential : aucune source construite, mais 7 diagnostics 'enabled: false' — jamais une exception", () => {
    const result = buildMarketSourcesFromEnv();
    expect(result.sources).toEqual([]);
    expect(result.diagnostics).toHaveLength(7);
    expect(result.diagnostics.every((d) => d.enabled === false)).toBe(true);
  });

  it("les diagnostics ne portent QUE des noms, jamais une valeur de credential", () => {
    process.env.SERPAPI_KEY = "super-secret-serpapi-key";
    const result = buildMarketSourcesFromEnv();
    const serialized = JSON.stringify(result.diagnostics);
    expect(serialized).not.toContain("super-secret-serpapi-key");
  });

  it("une seule credential posée (Keepa) active UNIQUEMENT cette source, jamais les autres", () => {
    process.env.KEEPA_API_KEY = "test-keepa-key";
    const result = buildMarketSourcesFromEnv();
    expect(result.sources.map((s) => s.source)).toEqual(["keepa"]);
    const keepaDiag = result.diagnostics.find((d) => d.name === "keepa");
    expect(keepaDiag?.enabled).toBe(true);
    expect(result.diagnostics.filter((d) => d.enabled)).toHaveLength(1);
  });

  it("BrickLink exige les 4 credentials — partielles = non construit", () => {
    process.env.BRICKLINK_CONSUMER_KEY = "k";
    process.env.BRICKLINK_CONSUMER_SECRET = "s";
    // token/tokenSecret manquants.
    const result = buildMarketSourcesFromEnv();
    expect(result.diagnostics.find((d) => d.name === "bricklink")?.enabled).toBe(false);
  });

  it("BrickLink avec les 4 credentials : construit", () => {
    process.env.BRICKLINK_CONSUMER_KEY = "k";
    process.env.BRICKLINK_CONSUMER_SECRET = "s";
    process.env.BRICKLINK_TOKEN_VALUE = "t";
    process.env.BRICKLINK_TOKEN_SECRET = "ts";
    const result = buildMarketSourcesFromEnv();
    expect(result.diagnostics.find((d) => d.name === "bricklink")?.enabled).toBe(true);
    expect(result.sources.map((s) => s.source)).toContain("bricklink");
  });

  it("PriceCharting avec token : construit", () => {
    process.env.PRICECHARTING_TOKEN = "t";
    const result = buildMarketSourcesFromEnv();
    expect(result.sources.map((s) => s.source)).toContain("pricecharting");
  });

  it("Ricardo exige ZYTE_API_KEY (le fournisseur de scraping générique), pas de credential Ricardo dédiée", () => {
    process.env.ZYTE_API_KEY = "z";
    const result = buildMarketSourcesFromEnv();
    expect(result.sources.map((s) => s.source)).toContain("ricardo");
  });

  it("DataForSEO exige LOGIN + PASSWORD, jamais une seule des deux", () => {
    process.env.DATAFORSEO_LOGIN = "login";
    const partial = buildMarketSourcesFromEnv();
    expect(partial.diagnostics.find((d) => d.name === "dataforseo_google_shopping")?.enabled).toBe(false);

    process.env.DATAFORSEO_PASSWORD = "password";
    const complete = buildMarketSourcesFromEnv();
    expect(complete.sources.map((s) => s.source)).toContain("dataforseo_google_shopping");
  });

  it("DataForSEO : DATAFORSEO_LOCATION_CODE surcharge le code de géociblage par défaut sans code", () => {
    process.env.DATAFORSEO_LOGIN = "login";
    process.env.DATAFORSEO_PASSWORD = "password";
    process.env.DATAFORSEO_LOCATION_CODE = "2840"; // US, juste pour prouver que la valeur env est bien lue
    const result = buildMarketSourcesFromEnv();
    expect(result.diagnostics.find((d) => d.name === "dataforseo_google_shopping")?.enabled).toBe(true);
  });

  it("toutes les credentials posées : les 7 sources sont construites", () => {
    process.env.EBAY_CLIENT_ID = "id";
    process.env.EBAY_CLIENT_SECRET = "secret";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_CH";
    process.env.EBAY_ENVIRONMENT = "sandbox";
    process.env.SERPAPI_KEY = "s";
    process.env.DATAFORSEO_LOGIN = "login";
    process.env.DATAFORSEO_PASSWORD = "password";
    process.env.BRICKLINK_CONSUMER_KEY = "k";
    process.env.BRICKLINK_CONSUMER_SECRET = "s";
    process.env.BRICKLINK_TOKEN_VALUE = "t";
    process.env.BRICKLINK_TOKEN_SECRET = "ts";
    process.env.PRICECHARTING_TOKEN = "t";
    process.env.KEEPA_API_KEY = "k";
    process.env.ZYTE_API_KEY = "z";

    const result = buildMarketSourcesFromEnv();
    expect(result.sources).toHaveLength(7);
    expect(result.diagnostics.every((d) => d.enabled)).toBe(true);
  });
});
