import { describe, expect, it } from "vitest";
import { decideNextSnapshotRefresh } from "../snapshot-scheduling-policy";

const ASOF = "2026-09-21T00:00:00.000Z";
const oneDayAgo = "2026-09-20T00:00:00.000Z";
const oneMonthAgo = "2026-08-21T00:00:00.000Z";

describe("decideNextSnapshotRefresh", () => {
  it("produit jamais rafraîchi -> éligible immédiatement, priorité maximale", () => {
    const decision = decideNextSnapshotRefresh({ asOf: ASOF, lastRefreshedAt: null, priceVolatility: null, recentActivity: false, costClass: "free" });
    expect(decision.nextRefreshAt).toBe(ASOF);
    expect(decision.priority).toBe(100);
  });

  it("produit CHAUD (activité récente + volatil) -> intervalle court, priorité haute", () => {
    const decision = decideNextSnapshotRefresh({ asOf: ASOF, lastRefreshedAt: oneDayAgo, priceVolatility: 0.3, recentActivity: true, costClass: "free" });
    expect(decision.priority).toBeGreaterThanOrEqual(90);
  });

  it("produit STABLE (pas d'activité, prix stable) -> intervalle long, priorité basse", () => {
    const decision = decideNextSnapshotRefresh({ asOf: ASOF, lastRefreshedAt: oneDayAgo, priceVolatility: 0.02, recentActivity: false, costClass: "free" });
    expect(decision.priority).toBeLessThanOrEqual(30);
    // Rafraîchi hier, base 168h (7 jours) -> prochain rafraîchissement dans le futur, pas encore éligible.
    expect(Date.parse(decision.nextRefreshAt)).toBeGreaterThan(Date.parse(ASOF));
  });

  it("prix VOLATIL (sans activité récente) -> rafraîchi plus souvent qu'un produit stable", () => {
    const stable = decideNextSnapshotRefresh({ asOf: ASOF, lastRefreshedAt: oneDayAgo, priceVolatility: 0.02, recentActivity: false, costClass: "free" });
    const volatile = decideNextSnapshotRefresh({ asOf: ASOF, lastRefreshedAt: oneDayAgo, priceVolatility: 0.3, recentActivity: false, costClass: "free" });
    expect(Date.parse(volatile.nextRefreshAt)).toBeLessThan(Date.parse(stable.nextRefreshAt));
    expect(volatile.priority).toBeGreaterThan(stable.priority);
  });

  it("contrainte de SOURCE CHÈRE (high_cost) : jamais rafraîchi plus vite que le plancher, même pour un produit chaud", () => {
    const decision = decideNextSnapshotRefresh({ asOf: ASOF, lastRefreshedAt: oneDayAgo, priceVolatility: 0.3, recentActivity: true, costClass: "high_cost" });
    // Base "chaud" = 6h, mais plancher high_cost = 48h -> doit respecter le plancher.
    const hoursUntilNext = (Date.parse(decision.nextRefreshAt) - Date.parse(oneDayAgo)) / (1000 * 60 * 60);
    expect(hoursUntilNext).toBeGreaterThanOrEqual(48);
    expect(decision.reason).toContain("high_cost");
  });

  it("produit STALE (rafraîchi il y a longtemps, déjà en retard sur son propre calendrier) -> éligible maintenant", () => {
    const decision = decideNextSnapshotRefresh({ asOf: ASOF, lastRefreshedAt: oneMonthAgo, priceVolatility: 0.02, recentActivity: false, costClass: "free" });
    expect(decision.nextRefreshAt).toBe(ASOF);
    expect(decision.reason).toContain("retard");
  });

  it("jamais un plancher de coût inférieur à l'intervalle de base — le plancher ne raccourcit jamais un intervalle déjà plus long", () => {
    const decision = decideNextSnapshotRefresh({ asOf: ASOF, lastRefreshedAt: oneDayAgo, priceVolatility: 0.02, recentActivity: false, costClass: "cheap" });
    const hoursUntilNext = (Date.parse(decision.nextRefreshAt) - Date.parse(oneDayAgo)) / (1000 * 60 * 60);
    expect(hoursUntilNext).toBeGreaterThanOrEqual(168); // base stable, jamais raccourci par un plancher "cheap" (4h) plus petit
  });
});
