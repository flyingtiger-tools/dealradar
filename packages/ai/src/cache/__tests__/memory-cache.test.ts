import { describe, expect, it, vi, afterEach } from "vitest";
import { createMemoryCache } from "../memory-cache";

describe("createMemoryCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retourne null pour une clé absente", async () => {
    const cache = createMemoryCache();
    expect(await cache.get("missing")).toBeNull();
  });

  it("retourne l'entrée écrite tant qu'elle n'a pas expiré", async () => {
    const cache = createMemoryCache();
    const entry = { product: {} as never, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    await cache.set("key", entry);
    expect(await cache.get("key")).toEqual(entry);
  });

  it("retourne null et purge une entrée expirée", async () => {
    const cache = createMemoryCache();
    const entry = { product: {} as never, expiresAt: new Date(Date.now() - 1000).toISOString() };
    await cache.set("key", entry);
    expect(await cache.get("key")).toBeNull();
  });
});
