import { describe, expect, it } from "vitest";
import type { FxRate } from "@dealradar/connectors";
import { persistFxRate } from "../persist-fx-rate";
import { FakeSupabase } from "./fake-supabase";

function fxRate(overrides: Partial<FxRate> = {}): FxRate {
  return {
    baseCurrency: "USD",
    quoteCurrency: "CHF",
    rate: 0.9,
    rateDate: "2026-07-31",
    source: "openexchangerates",
    fetchedAt: "2026-07-31T08:00:00.000Z",
    ...overrides,
  };
}

describe("persistFxRate", () => {
  it("insère un nouveau taux", async () => {
    const supabase = new FakeSupabase();
    const outcome = await persistFxRate(supabase as never, fxRate());

    expect(outcome.outcome).toBe("inserted");
    expect(supabase.table("fx_rates")).toHaveLength(1);
    expect(supabase.table("fx_rates")[0]!.rate).toBe(0.9);
  });

  it("idempotent : un rerun identique ne crée aucun doublon", async () => {
    const supabase = new FakeSupabase();
    await persistFxRate(supabase as never, fxRate());
    const second = await persistFxRate(supabase as never, fxRate({ fetchedAt: "2026-07-31T09:00:00.000Z" }));

    expect(second.outcome).toBe("unchanged");
    expect(supabase.table("fx_rates")).toHaveLength(1);
  });

  it("une date différente crée une nouvelle ligne (historique préservé)", async () => {
    const supabase = new FakeSupabase();
    await persistFxRate(supabase as never, fxRate({ rateDate: "2026-07-30" }));
    await persistFxRate(supabase as never, fxRate({ rateDate: "2026-07-31" }));

    expect(supabase.table("fx_rates")).toHaveLength(2);
  });

  it("une paire de devises différente crée une nouvelle ligne", async () => {
    const supabase = new FakeSupabase();
    await persistFxRate(supabase as never, fxRate({ quoteCurrency: "CHF" }));
    await persistFxRate(supabase as never, fxRate({ quoteCurrency: "EUR" }));

    expect(supabase.table("fx_rates")).toHaveLength(2);
  });

  it("une source différente crée une nouvelle ligne", async () => {
    const supabase = new FakeSupabase();
    await persistFxRate(supabase as never, fxRate({ source: "openexchangerates" }));
    await persistFxRate(supabase as never, fxRate({ source: "another-provider" }));

    expect(supabase.table("fx_rates")).toHaveLength(2);
  });
});
