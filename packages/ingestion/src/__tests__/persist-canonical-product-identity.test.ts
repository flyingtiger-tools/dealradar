import { describe, expect, it } from "vitest";
import { createCanonicalProductIdentity, mergeIdentityEvidence } from "@dealradar/core";
import { FakeSupabase } from "./fake-supabase";
import { persistCanonicalProductIdentity } from "../persist-canonical-product-identity";

const ASOF = "2026-09-21T00:00:00.000Z";

describe("persistCanonicalProductIdentity", () => {
  it("persiste market_products avec les champs doux connus", async () => {
    const identity = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "ai_identification",
      confidence: 0.8,
      observedAt: ASOF,
      fields: { brand: "Apple", model: "iPhone 13" },
    }).identity;

    const db = new FakeSupabase();
    const result = await persistCanonicalProductIdentity(db as never, identity);

    expect(result.productKey).toBe("apple:iphone-13");
    const product = db.table("market_products")[0] as { brand: string; model: string; category_slug: string };
    expect(product.brand).toBe("Apple");
    expect(product.model).toBe("iPhone 13");
    expect(product.category_slug).toBe("apple");
  });

  it("persiste chaque claim (champ dur ET doux) comme une ligne market_product_identifiers avec provenance", async () => {
    const identity = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13-128gb"), {
      source: "ebay",
      confidence: 0.9,
      observedAt: ASOF,
      fields: { upc: "0194252707326", storage: "128GB" },
    }).identity;

    const db = new FakeSupabase();
    const result = await persistCanonicalProductIdentity(db as never, identity);

    expect(result.identifierRowsUpserted).toBe(2);
    const rows = db.table("market_product_identifiers") as { field: string; value: string; source: string }[];
    expect(rows.find((r) => r.field === "upc")?.value).toBe("0194252707326");
    expect(rows.find((r) => r.field === "storage")?.value).toBe("128GB");
    expect(rows.every((r) => r.source === "ebay")).toBe(true);
  });

  it("persiste les alias avec leur nom de champ LIBRE, jamais forcé dans un champ structuré", async () => {
    const identity = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "google_shopping",
      confidence: 0.7,
      observedAt: ASOF,
      fields: {},
      aliases: [{ field: "googleProductId", value: "gp-123" }],
    }).identity;

    const db = new FakeSupabase();
    await persistCanonicalProductIdentity(db as never, identity);

    const rows = db.table("market_product_identifiers") as { field: string; value: string }[];
    expect(rows).toEqual([{ product_key: "apple:iphone-13", field: "googleProductId", value: "gp-123", source: "google_shopping", confidence: 0.7, observed_at: ASOF, id: expect.any(String) }]);
  });

  it("un CONFLIT non résolu (deux UPC différents) persiste DEUX lignes distinctes — la claim retenue ET la claim en désaccord, jamais fusionnées ni perdues (LOT 'Close the Refresh Loop', section 8)", async () => {
    const first = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "ebay",
      confidence: 0.9,
      observedAt: ASOF,
      fields: { upc: "111111111111" },
    }).identity;
    const identity = mergeIdentityEvidence(first, { source: "google_shopping", confidence: 0.8, observedAt: ASOF, fields: { upc: "222222222222" } }).identity;

    const db = new FakeSupabase();
    await persistCanonicalProductIdentity(db as never, identity);

    // La claim EXISTANTE (ebay, jamais écrasée en mémoire) reste "identity.fields.upc" ET la claim conflictuelle (google_shopping) est persistée comme preuve de désaccord — deux lignes, jamais une seule ni une fusion silencieuse.
    const rows = db.table("market_product_identifiers") as { field: string; value: string; source: string }[];
    const upcRows = rows.filter((r) => r.field === "upc");
    expect(upcRows).toHaveLength(2);
    expect(upcRows.find((r) => r.source === "ebay")?.value).toBe("111111111111");
    expect(upcRows.find((r) => r.source === "google_shopping")?.value).toBe("222222222222");
  });

  it("idempotent : persister deux fois la même identité ne duplique jamais les lignes (upsert sur la contrainte unique)", async () => {
    const identity = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "ebay",
      confidence: 0.9,
      observedAt: ASOF,
      fields: { upc: "111111111111" },
    }).identity;

    const db = new FakeSupabase();
    await persistCanonicalProductIdentity(db as never, identity);
    await persistCanonicalProductIdentity(db as never, identity);

    expect(db.table("market_product_identifiers")).toHaveLength(1);
    expect(db.table("market_products")).toHaveLength(1);
  });
});
