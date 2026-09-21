import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { checkHistoricalEngineAvailability } from "../check-historical-engine-availability";

describe("checkHistoricalEngineAvailability", () => {
  it("toutes les tables disponibles : allTablesAvailable true", async () => {
    const db = new FakeSupabase();
    const result = await checkHistoricalEngineAvailability(db as never);
    expect(result.allTablesAvailable).toBe(true);
    expect(result.tables.every((t) => t.available)).toBe(true);
    expect(result.tables.length).toBeGreaterThan(0);
  });

  it("une seule table manquante suffit à rendre allTablesAvailable false", async () => {
    const fakeSupabaseWithMissingTable = {
      from(table: string) {
        return {
          select() {
            return this;
          },
          limit() {
            if (table === "market_refresh_runs") return Promise.resolve({ error: { message: 'relation "market_refresh_runs" does not exist' } });
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    const result = await checkHistoricalEngineAvailability(fakeSupabaseWithMissingTable as never);
    expect(result.allTablesAvailable).toBe(false);
    expect(result.tables.find((t) => t.table === "market_refresh_runs")?.available).toBe(false);
    expect(result.tables.find((t) => t.table === "market_observations")?.available).toBe(true);
  });
});
