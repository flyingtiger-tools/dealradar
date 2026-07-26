import { describe, expect, it } from "vitest";
import { extractProduct } from "../extract-product";
import type { AIProvider } from "../../provider/types";
import type { BudgetGuard } from "../../budget/types";
import type { ExtractionInput } from "../../types";

/**
 * Simule la garantie transactionnelle du mécanisme réel (`reserve_ai_budget`,
 * verrou `pg_advisory_xact_lock` — migration 0011) : un budget partagé,
 * décrémenté de façon atomique via une file de promesses (équivalent en
 * mémoire d'un verrou transactionnel), jamais deux réservations
 * simultanées ne peuvent consommer le même reliquat.
 */
function createSharedBudgetGuard(dailyBudgetUsd: number): BudgetGuard {
  let spent = 0;
  let lock: Promise<void> = Promise.resolve();

  return {
    async reserve(maxCostUsd) {
      let release: () => void = () => undefined;
      const previous = lock;
      lock = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (spent + maxCostUsd > dailyBudgetUsd) return null;
        spent += maxCostUsd;
        return { reservationId: `res-${spent}` };
      } finally {
        release();
      }
    },
    async finalize() {
      // no-op pour ce test — le coût réel resterait <= la réservation.
    },
    async release() {
      // no-op pour ce test.
    },
  };
}

const input: ExtractionInput = { title: "iPhone en excellent état", categorySlug: "apple", images: [] };

function slowProvider(): AIProvider {
  return {
    name: "openai",
    model: "gpt-4o-mini",
    async extract() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { raw: { attributes: { storageGb: 128 } }, usage: { inputUnits: 2000, outputUnits: 500 } };
    },
  };
}

describe("budget atomique — concurrence", () => {
  it("deux extractions concurrentes ne peuvent jamais consommer plus que le budget journalier", async () => {
    // Coût max estimé par appel ~ (2000+300*0)/1e6*0.15 + 500/1e6*0.6 ≈ 0.00060. Budget pour un seul appel.
    const budgetGuard = createSharedBudgetGuard(0.0007);
    const provider = slowProvider();

    const [first, second] = await Promise.all([
      extractProduct(input, { provider, budgetGuard }),
      extractProduct(input, { provider, budgetGuard }),
    ]);

    const outcomes = [first, second];
    const succeeded = outcomes.filter((r) => r.source === "ai");
    const budgetExceeded = outcomes.filter((r) => r.warnings.some((w) => w.code === "BUDGET_EXCEEDED"));

    expect(succeeded).toHaveLength(1);
    expect(budgetExceeded).toHaveLength(1);
  });

  it("un budget suffisant pour les deux appels laisse les deux réussir", async () => {
    const budgetGuard = createSharedBudgetGuard(1);
    const provider = slowProvider();

    const [first, second] = await Promise.all([
      extractProduct(input, { provider, budgetGuard }),
      extractProduct(input, { provider, budgetGuard }),
    ]);

    expect(first.source).toBe("ai");
    expect(second.source).toBe("ai");
  });
});
