import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { persistResearchTarget } from "../persist-research-target";

describe("persistResearchTarget", () => {
  it("insère une nouvelle cible de recherche", async () => {
    const db = new FakeSupabase();
    const result = await persistResearchTarget(db as never, {
      productKey: "apple:iphone-13",
      reason: "user_scan",
      priority: 80,
      desiredCurrency: "CHF",
      enabled: true,
      nextRefreshAt: "2026-09-21T00:00:00.000Z",
    });

    expect(result.outcome).toBe("inserted");
    expect(db.table("research_targets")).toHaveLength(1);
  });

  it("un second scan du MÊME produit dans la MÊME devise met à jour la cible existante, jamais un doublon", async () => {
    const db = new FakeSupabase();
    await persistResearchTarget(db as never, { productKey: "apple:iphone-13", reason: "user_scan", priority: 50, desiredCurrency: "CHF", enabled: true });
    const second = await persistResearchTarget(db as never, { productKey: "apple:iphone-13", reason: "watchlist", priority: 90, desiredCurrency: "CHF", enabled: true });

    expect(second.outcome).toBe("updated");
    expect(db.table("research_targets")).toHaveLength(1);
    expect((db.table("research_targets")[0] as { priority: number }).priority).toBe(90);
  });

  it("même produit, devises DIFFÉRENTES : deux cibles distinctes, jamais fusionnées", async () => {
    const db = new FakeSupabase();
    await persistResearchTarget(db as never, { productKey: "apple:iphone-13", reason: "user_scan", priority: 50, desiredCurrency: "CHF", enabled: true });
    await persistResearchTarget(db as never, { productKey: "apple:iphone-13", reason: "user_scan", priority: 50, desiredCurrency: "USD", enabled: true });

    expect(db.table("research_targets")).toHaveLength(2);
  });

  it("raison invalide (hors enum) : rejetée, jamais persistée", async () => {
    const db = new FakeSupabase();
    await expect(
      persistResearchTarget(db as never, { productKey: "x", reason: "bogus" as never, priority: 50, desiredCurrency: "CHF", enabled: true }),
    ).rejects.toThrow();
    expect(db.table("research_targets")).toEqual([]);
  });
});
