import { describe, expect, it } from "vitest";
import { createTimingCache } from "../timing-cache";
import { createMemoryCache } from "@dealradar/ai";

describe("createTimingCache", () => {
  it("délègue get/set au cache interne et accumule les durées", async () => {
    const inner = createMemoryCache();
    const { cache, timings } = createTimingCache(inner);

    expect(await cache.get("missing")).toBeNull();
    await cache.set("key", { product: {} as never, expiresAt: new Date(Date.now() + 1000).toISOString() });
    const hit = await cache.get("key");

    expect(hit).not.toBeNull();
    expect(timings.getCalls).toBe(2);
    expect(timings.setCalls).toBe(1);
    expect(timings.totalMs).toBeGreaterThanOrEqual(0);
  });
});
