import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs, refuseIfPolicyLocked, SmokeTestExit, EXIT_POLICY_BLOCKED } from "../source-smoke-test";

describe("parseArgs", () => {
  it("exige --source, --category, et au moins un --field", () => {
    expect(() => parseArgs([])).toThrow(/--source/);
    expect(() => parseArgs(["--source", "bricklink"])).toThrow(/--category/);
    expect(() => parseArgs(["--source", "bricklink", "--category", "lego"])).toThrow(/--field/);
  });

  it("parse les champs, la source, la catégorie, et --dry-run", () => {
    const args = parseArgs(["--source", "bricklink", "--category", "lego", "--field", "bricklinkNo=10300", "--dry-run"]);
    expect(args.source).toBe("bricklink");
    expect(args.categorySlug).toBe("lego");
    expect(args.fields.bricklinkNo).toBe("10300");
    expect(args.dryRun).toBe(true);
  });

  it("dry-run absent par défaut", () => {
    const args = parseArgs(["--source", "keepa", "--category", "apple", "--field", "asin=B0X"]);
    expect(args.dryRun).toBe(false);
  });

  it("plusieurs --field sont tous retenus", () => {
    const args = parseArgs(["--source", "ebay", "--category", "gaming", "--field", "brand=Nintendo", "--field", "model=Switch"]);
    expect(args.fields.brand).toBe("Nintendo");
    expect(args.fields.model).toBe("Switch");
  });

  it("--currency et --timeout-ms optionnels, valeurs par défaut sûres sinon", () => {
    const withOverrides = parseArgs(["--source", "keepa", "--category", "apple", "--field", "asin=B0X", "--currency", "CHF", "--timeout-ms", "5000"]);
    expect(withOverrides.currency).toBe("CHF");
    expect(withOverrides.timeoutMs).toBe(5000);

    const withoutOverrides = parseArgs(["--source", "keepa", "--category", "apple", "--field", "asin=B0X"]);
    expect(withoutOverrides.currency).toBeNull();
    expect(withoutOverrides.timeoutMs).toBe(15000);
  });

  it("--timeout-ms invalide (non numérique ou <= 0) ignoré, conserve le défaut", () => {
    const args = parseArgs(["--source", "keepa", "--category", "apple", "--field", "asin=B0X", "--timeout-ms", "abc"]);
    expect(args.timeoutMs).toBe(15000);
  });
});

describe("refuseIfPolicyLocked", () => {
  it("refuse Ricardo (restricted) même sans vérifier de credentials", () => {
    expect(() => refuseIfPolicyLocked("ricardo")).toThrow(/restricted|verrouillée/);
  });

  it("refuse PriceCharting (license_required)", () => {
    expect(() => refuseIfPolicyLocked("pricecharting")).toThrow(/license_required|verrouillée/);
  });

  it("n'objecte pas pour une source non verrouillée par politique (ex. keepa, missing_credentials seul)", () => {
    expect(() => refuseIfPolicyLocked("keepa")).not.toThrow();
  });

  it("n'objecte pas pour une source hors matrice — laisse le chemin normal décider", () => {
    expect(() => refuseIfPolicyLocked("some_future_source")).not.toThrow();
  });

  it("lève une SmokeTestExit avec le code de sortie EXIT_POLICY_BLOCKED (3)", () => {
    try {
      refuseIfPolicyLocked("ricardo");
      expect.fail("devait lever");
    } catch (error) {
      expect(error).toBeInstanceOf(SmokeTestExit);
      expect((error as SmokeTestExit).code).toBe(EXIT_POLICY_BLOCKED);
      expect(EXIT_POLICY_BLOCKED).toBe(3);
    }
  });
});

// Régression du bug de garde-fou CLI (LOT "Free/Open Sources + Real
// Readiness + Live Smoke Tests", section 12) — un précédent BUILDER
// HANDOFF l'avait explicitement identifié (même défaut que
// `activation-preflight.ts` : `import.meta.url === \`file://${process.
// argv[1]}\`` ne matche JAMAIS sous Windows, car `process.argv[1]` porte
// des antislash) mais l'avait laissé hors scope. `parseArgs`/
// `refuseIfPolicyLocked` (testés ci-dessus) prouvent que la LOGIQUE est
// correcte — mais PAS que `main()` s'exécute réellement quand ce fichier
// est lancé directement (`tsx source-smoke-test.ts ...`), ce qui est
// exactement ce que le bug de garde-fou cassait silencieusement. Seul un
// VRAI sous-processus peut prouver ça.
describe("garde-fou CLI (exécution directe via tsx)", () => {
  it("s'exécute réellement et sort avec EXIT_POLICY_BLOCKED (3) pour une source verrouillée par politique — jamais un exit 0 silencieux dû à un garde-fou qui ne se déclenche pas", () => {
    const scriptPath = join(__dirname, "..", "source-smoke-test.ts");
    const workersRoot = join(__dirname, "..", "..", "..");
    // `node <tsx/dist/cli.mjs>` directement (jamais le shim `.bin/tsx.CMD`)
    // — le shim Windows se lance via un `.CMD` batch, que `execFileSync`
    // ne peut pas exécuter de façon fiable sans `shell: true` (qui
    // introduit sa propre interprétation d'échappement des arguments) ;
    // résoudre le point d'entrée réel évite ce problème entièrement.
    const tsxCli = join(workersRoot, "node_modules", "tsx", "dist", "cli.mjs");

    let status = 0;
    try {
      execFileSync(process.execPath, [tsxCli, scriptPath, "--source", "ricardo", "--category", "general", "--field", "x=1"], {
        cwd: workersRoot,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      status = (error as { status?: number }).status ?? -1;
    }

    expect(status).toBe(3);
  });
});
