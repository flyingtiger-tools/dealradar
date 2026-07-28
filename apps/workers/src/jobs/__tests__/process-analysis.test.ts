import { describe, it, expect, beforeEach } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { processAnalysis } from "../process-analysis";

const ANALYSIS_ID = "analysis-1";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ANALYSIS_ID,
    title: "LEGO 75313 très bon état",
    description: null,
    category_slug: "lego",
    purchase_price: 25,
    currency: "CHF",
    image_references: [],
    source_type: "manual_entry",
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.AI_PROVIDER;
});

describe("processAnalysis", () => {
  it("insufficient_data + CATEGORY_REQUIRED quand la catégorie n'est pas confirmée", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow({ category_slug: null })]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as { status: string; result: { warnings: string[] } };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.warnings).toContain("CATEGORY_REQUIRED");
  });

  it("insufficient_data + CONDITION_UNKNOWN quand l'état n'est pas détecté", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow({ title: "LEGO 75313" })]); // pas de mot-clé d'état

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: { warnings: string[]; product: { modelOrReference: string | null } };
    };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.warnings).toContain("CONDITION_UNKNOWN");
    // L'identification produit reste utile même sans état détecté.
    expect(row.result.product.modelOrReference).toBe("75313");
  });

  it("insufficient_data + PURCHASE_PRICE_REQUIRED quand le prix d'achat n'est pas confirmé", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow({ purchase_price: null })]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: { warnings: string[]; conditionEstimated: string | null };
    };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.warnings).toContain("PURCHASE_PRICE_REQUIRED");
    expect(row.result.conditionEstimated).toBe("very_good");
  });

  it("insufficient_data quand aucun comparable vendu ne correspond (identification correcte malgré tout)", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    // Aucune ligne dans `listings` : pool de comparables vide.

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: {
        decision: string;
        product: { name: string | null; modelOrReference: string | null };
        conditionEstimated: string | null;
        priceDetected: { amount: number; currency: string } | null;
        dataAvailability: { soldTransactions: boolean };
      };
    };
    expect(row.status).toBe("insufficient_data");
    expect(row.result.decision).toBe("INSUFFICIENT_DATA");
    expect(row.result.product.modelOrReference).toBe("75313");
    expect(row.result.conditionEstimated).toBe("very_good");
    expect(row.result.priceDetected).toEqual({ amount: 25, currency: "CHF" });
    expect(row.result.dataAvailability.soldTransactions).toBe(false);
  });

  it("utilise le pool de comparables vendus déjà persisté (dataAvailability.soldTransactions=true)", async () => {
    const db = new FakeSupabase();
    db.seed("analysis_requests", [baseRow()]);
    db.seed("listings", [
      {
        id: "sold-1",
        title: "LEGO 75313 vendu",
        price_cents: 3500,
        currency: "CHF",
        condition: "very_good",
        status: "sold",
        sold_at: new Date().toISOString(),
        attributes: { categorySlug: "lego", setNumber: "75313" },
        sources: { slug: "ebay" },
      },
      {
        id: "sold-2",
        title: "LEGO 75313 vendu 2",
        price_cents: 4000,
        currency: "CHF",
        condition: "very_good",
        status: "sold",
        sold_at: new Date().toISOString(),
        attributes: { categorySlug: "lego", setNumber: "75313" },
        sources: { slug: "ebay" },
      },
      {
        id: "sold-3",
        title: "LEGO 75313 vendu 3",
        price_cents: 3800,
        currency: "CHF",
        condition: "very_good",
        status: "sold",
        sold_at: new Date().toISOString(),
        attributes: { categorySlug: "lego", setNumber: "75313" },
        sources: { slug: "ebay" },
      },
    ]);

    await processAnalysis({ analysisRequestId: ANALYSIS_ID }, db as never);

    const row = db.table("analysis_requests")[0] as {
      status: string;
      result: { dataAvailability: { soldTransactions: boolean }; marketValueEstimate: { provenance: string } | null };
    };
    expect(row.result.dataAvailability.soldTransactions).toBe(true);
    expect(row.result.marketValueEstimate?.provenance).toBe("sold_transaction");
  });
});
