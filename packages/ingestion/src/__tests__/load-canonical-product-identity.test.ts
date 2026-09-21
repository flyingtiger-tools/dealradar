import { describe, expect, it } from "vitest";
import { createCanonicalProductIdentity, mergeIdentityEvidence } from "@dealradar/core";
import { FakeSupabase } from "./fake-supabase";
import { persistCanonicalProductIdentity } from "../persist-canonical-product-identity";
import { loadCanonicalProductIdentity } from "../load-canonical-product-identity";

const ASOF = "2026-09-21T00:00:00.000Z";

describe("loadCanonicalProductIdentity", () => {
  it("renvoie null pour un productKey inconnu — jamais une identité vide fabriquée", async () => {
    const db = new FakeSupabase();
    const identity = await loadCanonicalProductIdentity(db as never, "apple:unknown");
    expect(identity).toBeNull();
  });

  it("recharge une identité persistée avec ses champs durs et doux, identique à celle écrite", async () => {
    const original = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "ebay",
      confidence: 0.9,
      observedAt: ASOF,
      fields: { brand: "Apple", model: "iPhone 13", upc: "0194252707326" },
    }).identity;

    const db = new FakeSupabase();
    await persistCanonicalProductIdentity(db as never, original);

    const reloaded = await loadCanonicalProductIdentity(db as never, "apple:iphone-13");
    expect(reloaded?.fields.brand?.value).toBe("Apple");
    expect(reloaded?.fields.upc?.value).toBe("0194252707326");
    expect(reloaded?.categorySlug).toBe("apple");
  });

  it("recharge un alias avec son nom de champ libre", async () => {
    const original = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "google_shopping",
      confidence: 0.7,
      observedAt: ASOF,
      fields: {},
      aliases: [{ field: "googleProductId", value: "gp-123" }],
    }).identity;

    const db = new FakeSupabase();
    await persistCanonicalProductIdentity(db as never, original);

    const reloaded = await loadCanonicalProductIdentity(db as never, "apple:iphone-13");
    expect(reloaded?.aliases.find((a) => a.field === "googleProductId")?.value).toBe("gp-123");
  });

  it("recharge un conflit non résolu — les DEUX claims en désaccord réapparaissent après un aller-retour persistance/relecture", async () => {
    const first = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "ebay",
      confidence: 0.9,
      observedAt: "2026-09-20T00:00:00.000Z",
      fields: { upc: "111111111111" },
    }).identity;
    const original = mergeIdentityEvidence(first, {
      source: "google_shopping",
      confidence: 0.8,
      observedAt: "2026-09-21T00:00:00.000Z",
      fields: { upc: "222222222222" },
    }).identity;
    expect(original.conflicts).toHaveLength(1);

    const db = new FakeSupabase();
    await persistCanonicalProductIdentity(db as never, original);

    const reloaded = await loadCanonicalProductIdentity(db as never, "apple:iphone-13");
    expect(reloaded?.conflicts).toHaveLength(1);
    expect(reloaded?.fields.upc?.value).toBe("111111111111"); // la claim la plus ancienne reste "gagnante", jamais écrasée.
    expect(reloaded?.conflicts[0]?.claims.map((c) => c.value).sort()).toEqual(["111111111111", "222222222222"]);
  });
});
