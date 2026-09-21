import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Garde-fou de RÉGRESSION statique (LOT "Data Quality Calibration...",
 * section 6) — même patron que les vérifications "jamais fabriqué" déjà
 * en place ailleurs dans ce dépôt (ex. `confirmedSoldAt` dans la checklist
 * d'activation) : analyse le CODE SOURCE de chaque `normalize.ts`/`parse.ts`
 * de connecteur, jamais son comportement à l'exécution (chaque connecteur
 * a déjà ses propres tests unitaires pour ça).
 *
 * Objectif : `totalPriceCents` ne doit JAMAIS être posé à une valeur qui
 * pourrait double-compter le port (ex. `priceAmountCents + shippingCostCents`
 * alors qu'un total DÉJÀ inclusif côté source existerait) — à ce jour,
 * SEUL eBay calcule `totalPriceCents` (déjà testé directement,
 * `market-source-adapter.test.ts`) ; tous les autres connecteurs le posent
 * à `null`. Ce test échoue si un futur connecteur s'écarte de cette
 * discipline sans qu'un humain l'ait délibérément revu.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONNECTORS_SRC = path.resolve(HERE, "../../");

const KNOWN_TOTAL_PRICE_COMPUTERS = new Set(["ebay"]);

function findNormalizeFiles(): { connector: string; filePath: string }[] {
  const found: { connector: string; filePath: string }[] = [];
  for (const entry of readdirSync(CONNECTORS_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "market-intelligence" || entry.name.startsWith("__")) continue;
    const dir = path.join(CONNECTORS_SRC, entry.name);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (file === "normalize.ts" || file === "parse.ts") found.push({ connector: entry.name, filePath: path.join(dir, file) });
    }
  }
  return found;
}

describe("cohérence port/prix atterri entre connecteurs", () => {
  it("seuls les connecteurs déjà revus (eBay) posent totalPriceCents à une valeur calculée — tous les autres le laissent null, jamais un risque de double comptage silencieux", () => {
    const files = findNormalizeFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const { connector, filePath } of files) {
      const source = readFileSync(filePath, "utf8");
      if (!/totalPriceCents/.test(source)) continue; // ce connecteur ne mentionne même pas le champ — rien à vérifier.

      if (KNOWN_TOTAL_PRICE_COMPUTERS.has(connector)) {
        // Revu explicitement (voir market-source-adapter.test.ts) — doit calculer, jamais juste `null`.
        expect(source, `${connector} : attendu un calcul de totalPriceCents, pas seulement null`).toMatch(/totalPriceCents\s*[,=]/);
        continue;
      }

      // Tout connecteur NON répertorié dans KNOWN_TOTAL_PRICE_COMPUTERS doit poser totalPriceCents littéralement à `null` — jamais une expression calculée non revue.
      expect(source, `${connector} pose totalPriceCents à une valeur calculée sans revue explicite (ajouter "${connector}" à KNOWN_TOTAL_PRICE_COMPUTERS après vérification qu'aucun double comptage n'est possible)`).toMatch(
        /totalPriceCents:\s*null/,
      );
    }
  });

  it("chaque connecteur qui pose shippingCostCents à une valeur non-null pose aussi un totalPriceCents cohérent (jamais un port connu sans total, sauf s'il n'est pas encore calculé)", () => {
    // Vérification structurelle légère : un connecteur qui a un shippingCostCents dynamique (pas juste `null`) doit être dans KNOWN_TOTAL_PRICE_COMPUTERS, sinon le port est collecté mais jamais utilisé pour un total cohérent.
    const files = findNormalizeFiles();
    for (const { connector, filePath } of files) {
      const source = readFileSync(filePath, "utf8");
      const hasDynamicShipping = /shippingCostCents:\s*(?!null)[a-zA-Z]/.test(source);
      if (hasDynamicShipping) {
        expect(KNOWN_TOTAL_PRICE_COMPUTERS.has(connector), `${connector} calcule un shippingCostCents dynamique mais n'est pas dans KNOWN_TOTAL_PRICE_COMPUTERS`).toBe(true);
      }
    }
  });
});
