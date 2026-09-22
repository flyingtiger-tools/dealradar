import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs, refuseIfPolicyLocked, SmokeTestExit, EXIT_POLICY_BLOCKED, EXIT_NO_HINT } from "../catalog-smoke-test";

describe("parseArgs", () => {
  it("exige --source et --category", () => {
    expect(() => parseArgs([])).toThrow(/--source/);
    expect(() => parseArgs(["--source", "open_food_facts"])).toThrow(/--category/);
  });

  it("exige au moins un indice exact (--barcode/--lego-set/--gaming-title) — SmokeTestExit EXIT_NO_HINT (4), jamais une recherche floue", () => {
    try {
      parseArgs(["--source", "open_food_facts", "--category", "general"]);
      expect.fail("devait lever");
    } catch (error) {
      expect(error).toBeInstanceOf(SmokeTestExit);
      expect((error as SmokeTestExit).code).toBe(EXIT_NO_HINT);
      expect(EXIT_NO_HINT).toBe(4);
    }
  });

  it("parse --barcode", () => {
    const args = parseArgs(["--source", "open_food_facts", "--category", "general", "--barcode", "3017620422003"]);
    expect(args.source).toBe("open_food_facts");
    expect(args.categorySlug).toBe("general");
    expect(args.hints.barcode).toBe("3017620422003");
  });

  it("parse --lego-set", () => {
    const args = parseArgs(["--source", "rebrickable", "--category", "lego", "--lego-set", "10300"]);
    expect(args.hints.legoSetNumber).toBe("10300");
  });

  it("parse --gaming-title", () => {
    const args = parseArgs(["--source", "igdb", "--category", "gaming", "--gaming-title", "Halo Infinite"]);
    expect(args.hints.gamingTitle).toBe("Halo Infinite");
  });
});

describe("refuseIfPolicyLocked", () => {
  it("refuse IGDB (license_required) même sans vérifier de credentials", () => {
    expect(() => refuseIfPolicyLocked("igdb")).toThrow(/license_required|verrouillée/);
  });

  it("n'objecte pas pour une source catalogue non verrouillée par politique (ex. rebrickable, missing_credentials seul)", () => {
    expect(() => refuseIfPolicyLocked("rebrickable")).not.toThrow();
  });

  it("n'objecte pas pour upc.dev (compatible, missing_credentials seul)", () => {
    expect(() => refuseIfPolicyLocked("upcdev")).not.toThrow();
  });

  it("n'objecte pas pour une source hors matrice — laisse le chemin normal décider", () => {
    expect(() => refuseIfPolicyLocked("some_future_source")).not.toThrow();
  });

  it("lève une SmokeTestExit avec le code de sortie EXIT_POLICY_BLOCKED (3)", () => {
    try {
      refuseIfPolicyLocked("igdb");
      expect.fail("devait lever");
    } catch (error) {
      expect(error).toBeInstanceOf(SmokeTestExit);
      expect((error as SmokeTestExit).code).toBe(EXIT_POLICY_BLOCKED);
      expect(EXIT_POLICY_BLOCKED).toBe(3);
    }
  });
});

// Même régression du garde-fou CLI que `source-smoke-test.test.ts` (LOT
// "Free/Open Sources...", section 12) — preuve par sous-processus RÉEL que
// `main()` s'exécute effectivement quand ce fichier est lancé directement
// (`tsx catalog-smoke-test.ts ...`), pas seulement que la logique interne
// est correcte.
describe("garde-fou CLI (exécution directe via tsx)", () => {
  it("s'exécute réellement et sort avec EXIT_POLICY_BLOCKED (3) pour une source catalogue verrouillée par politique", () => {
    const scriptPath = join(__dirname, "..", "catalog-smoke-test.ts");
    const workersRoot = join(__dirname, "..", "..", "..");
    const tsxCli = join(workersRoot, "node_modules", "tsx", "dist", "cli.mjs");

    let status = 0;
    try {
      execFileSync(process.execPath, [tsxCli, scriptPath, "--source", "igdb", "--category", "gaming", "--gaming-title", "Halo Infinite"], {
        cwd: workersRoot,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      status = (error as { status?: number }).status ?? -1;
    }

    expect(status).toBe(3);
  });

  it("s'exécute réellement et sort avec EXIT_MISSING_CREDENTIALS (2) pour rebrickable sans REBRICKABLE_API_KEY", () => {
    const scriptPath = join(__dirname, "..", "catalog-smoke-test.ts");
    const workersRoot = join(__dirname, "..", "..", "..");
    const tsxCli = join(workersRoot, "node_modules", "tsx", "dist", "cli.mjs");

    let status = 0;
    try {
      execFileSync(process.execPath, [tsxCli, scriptPath, "--source", "rebrickable", "--category", "lego", "--lego-set", "10300"], {
        cwd: workersRoot,
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, REBRICKABLE_API_KEY: "" },
      });
    } catch (error) {
      status = (error as { status?: number }).status ?? -1;
    }

    expect(status).toBe(2);
  });
});
