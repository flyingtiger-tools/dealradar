import { describe, it, expect } from "vitest";
import { anonymizeEbaySellerData } from "../data-deletion";
import { createFakeListingsSupabase } from "./fake-listings-supabase";

describe("anonymizeEbaySellerData", () => {
  it("anonymise les annonces correspondant au nom d'utilisateur eBay", async () => {
    const supabase = createFakeListingsSupabase([
      { id: "l1", raw_payload: { itemId: "1", sellerUsername: "target-user" }, seller_external_id: null },
      { id: "l2", raw_payload: { itemId: "2", sellerUsername: "other-user" }, seller_external_id: null },
    ]);

    const result = await anonymizeEbaySellerData(supabase as never, { username: "target-user" });

    expect(result.listingsAnonymized).toBe(1);
    expect(supabase._rows.get("l1")!.raw_payload).toEqual({ itemId: "1" });
    expect(supabase._rows.get("l2")!.raw_payload).toEqual({ itemId: "2", sellerUsername: "other-user" });
  });

  it("est idempotente : une seconde exécution ne trouve plus rien à anonymiser", async () => {
    const supabase = createFakeListingsSupabase([
      { id: "l1", raw_payload: { itemId: "1", sellerUsername: "target-user" }, seller_external_id: null },
    ]);

    const first = await anonymizeEbaySellerData(supabase as never, { username: "target-user" });
    const second = await anonymizeEbaySellerData(supabase as never, { username: "target-user" });

    expect(first.listingsAnonymized).toBe(1);
    expect(second.listingsAnonymized).toBe(0);
  });

  it("anonymise aussi via seller_external_id (réservé pour un futur connecteur)", async () => {
    const supabase = createFakeListingsSupabase([
      { id: "l1", raw_payload: { itemId: "1" }, seller_external_id: "ebay-uid-1" },
    ]);

    const result = await anonymizeEbaySellerData(supabase as never, { userId: "ebay-uid-1" });

    expect(result.listingsAnonymized).toBe(1);
    expect(supabase._rows.get("l1")!.seller_external_id).toBeNull();
  });

  it("ne fait rien et signale correlationAttempted=false si aucun identifiant n'est fourni (notification non corrélable)", async () => {
    const supabase = createFakeListingsSupabase([
      { id: "l1", raw_payload: { sellerUsername: "target-user" }, seller_external_id: null },
    ]);

    const result = await anonymizeEbaySellerData(supabase as never, {});

    expect(result.correlationAttempted).toBe(false);
    expect(result.listingsAnonymized).toBe(0);
    // Aucun effacement incorrect : la donnée reste intacte, aucune recherche n'a été déclenchée.
    expect(supabase._rows.get("l1")!.raw_payload).toEqual({ sellerUsername: "target-user" });
  });

  it("signale correlationAttempted=true même quand aucune annonce ne correspond au nom d'utilisateur", async () => {
    const supabase = createFakeListingsSupabase([
      { id: "l1", raw_payload: { sellerUsername: "other-user" }, seller_external_id: null },
    ]);

    const result = await anonymizeEbaySellerData(supabase as never, { username: "unknown-user" });

    expect(result.correlationAttempted).toBe(true);
    expect(result.listingsAnonymized).toBe(0);
  });
});
