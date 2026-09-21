import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_READINESS_MATRIX } from "@dealradar/connectors";
import { MARKET_SOURCE_NAMES } from "@dealradar/ingestion";
import { buildMarketSourcesFromEnv } from "../market-source-factory";

/**
 * Test de COHÉRENCE de la matrice de préparation (LOT "Real DB Integration
 * + Exact Budget Enforcement + Runtime Observability", section 10) —
 * croise `SOURCE_READINESS_MATRIX` (`packages/connectors`), la fabrique
 * réelle (`market-source-factory.ts`, `apps/workers`), l'univers de
 * `SourceSelectionPlan` (`MARKET_SOURCE_NAMES`, `packages/ingestion`) et
 * la checklist d'activation (`docs/market-data-activation-checklist.md`).
 * Objectif explicite du lot : aucune source ne peut être
 * `productionAllowed` à un endroit et silencieusement bloquée/activée
 * différemment ailleurs.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../../");
const CHECKLIST_PATH = path.join(REPO_ROOT, "docs", "market-data-activation-checklist.md");

const ALL_ENV_KEYS = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_MARKETPLACE_ID",
  "EBAY_ENVIRONMENT",
  "SERPAPI_KEY",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "BRICKLINK_CONSUMER_KEY",
  "BRICKLINK_CONSUMER_SECRET",
  "BRICKLINK_TOKEN_VALUE",
  "BRICKLINK_TOKEN_SECRET",
  "PRICECHARTING_TOKEN",
  "KEEPA_API_KEY",
  "ZYTE_API_KEY",
] as const;

describe("cohérence de la matrice de préparation", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ALL_ENV_KEYS) {
      original[key] = process.env[key];
      // Fournit TOUTES les credentials possibles — prouve que la politique prime, jamais la seule présence de credentials.
      process.env[key] = "fake-value-for-consistency-test";
    }
    // EBAY_ENVIRONMENT exige une valeur STRUCTURELLEMENT valide ("sandbox"/"production", voir connector-config.ts) — une valeur factice générique romprait sa propre validation, indépendamment de toute politique de préparation.
    process.env.EBAY_ENVIRONMENT = "sandbox";
  });

  afterEach(() => {
    for (const key of ALL_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("l'univers `MARKET_SOURCE_NAMES` (packages/ingestion) correspond EXACTEMENT à l'univers réel de la fabrique (apps/workers) — jamais une source ajoutée à l'un sans l'autre", () => {
    const { diagnostics } = buildMarketSourcesFromEnv();
    const factoryNames = diagnostics.map((d) => d.name).sort();
    expect([...MARKET_SOURCE_NAMES].sort()).toEqual(factoryNames);
  });

  it("chaque source de `MARKET_SOURCE_NAMES` a un descripteur dans SOURCE_READINESS_MATRIX", () => {
    const matrixNames = new Set(SOURCE_READINESS_MATRIX.map((d) => d.source));
    for (const name of MARKET_SOURCE_NAMES) {
      expect(matrixNames.has(name), `"${name}" absent de SOURCE_READINESS_MATRIX`).toBe(true);
    }
  });

  it("aucune source `productionAllowed: false` n'est JAMAIS construite par la fabrique, même avec TOUTES les credentials présentes", () => {
    const { sources } = buildMarketSourcesFromEnv();
    const constructedNames = new Set(sources.map((s) => s.source));
    for (const descriptor of SOURCE_READINESS_MATRIX) {
      if (!MARKET_SOURCE_NAMES.includes(descriptor.source)) continue;
      if (!descriptor.productionAllowed) {
        expect(constructedNames.has(descriptor.source), `"${descriptor.source}" (productionAllowed=false) a été construite malgré tout`).toBe(false);
      }
    }
  });

  it("chaque source `productionAllowed: true` de la matrice EST construite dès que ses credentials sont présentes — jamais un blocage silencieux non documenté", () => {
    const { sources, diagnostics } = buildMarketSourcesFromEnv();
    const constructedNames = new Set(sources.map((s) => s.source));
    for (const descriptor of SOURCE_READINESS_MATRIX) {
      if (!MARKET_SOURCE_NAMES.includes(descriptor.source)) continue;
      if (descriptor.productionAllowed) {
        const diag = diagnostics.find((d) => d.name === descriptor.source);
        expect(constructedNames.has(descriptor.source), `"${descriptor.source}" (productionAllowed=true, readiness=${diag?.readiness}) n'a pas été construite malgré des credentials présentes`).toBe(true);
      }
    }
  });

  it("chaque source de MARKET_SOURCE_NAMES est référencée dans la checklist d'activation — jamais une source non documentée", () => {
    const checklist = readFileSync(CHECKLIST_PATH, "utf8").toLowerCase();
    for (const name of MARKET_SOURCE_NAMES) {
      // Insensible à la casse — la doc utilise des noms d'affichage (ex. "PriceCharting"), jamais forcément le slug technique exact ("pricecharting").
      expect(checklist.includes(name.toLowerCase().replace(/_/g, " ")) || checklist.includes(name.toLowerCase()), `"${name}" absent de docs/market-data-activation-checklist.md`).toBe(true);
    }
  });
});
