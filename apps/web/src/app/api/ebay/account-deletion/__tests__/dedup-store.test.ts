import { describe, it, expect, vi, afterEach } from "vitest";
import { createInMemoryDedupStore } from "../dedup-store";

afterEach(() => {
  vi.useRealTimers();
});

describe("createInMemoryDedupStore", () => {
  it("détecte un notificationId déjà marqué", () => {
    const store = createInMemoryDedupStore();
    expect(store.hasSeen("n1")).toBe(false);
    store.markSeen("n1");
    expect(store.hasSeen("n1")).toBe(true);
  });

  it("traite des notificationId différents indépendamment", () => {
    const store = createInMemoryDedupStore();
    store.markSeen("n1");
    expect(store.hasSeen("n1")).toBe(true);
    expect(store.hasSeen("n2")).toBe(false);
  });

  it("oublie un notificationId après expiration du TTL", () => {
    vi.useFakeTimers();
    const store = createInMemoryDedupStore(1000);
    store.markSeen("n1");
    expect(store.hasSeen("n1")).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(store.hasSeen("n1")).toBe(false);
  });

  it("ne marque rien tant que markSeen n'est pas appelé (hasSeen seul est un contrôle sans effet de bord)", () => {
    const store = createInMemoryDedupStore();
    expect(store.hasSeen("n1")).toBe(false);
    expect(store.hasSeen("n1")).toBe(false);
  });
});
