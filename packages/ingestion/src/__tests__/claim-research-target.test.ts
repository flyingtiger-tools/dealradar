import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { installSimulatedResearchTargetLeaseRpcs } from "./simulate-research-target-leases";
import { claimResearchTargets, releaseResearchTarget } from "../claim-research-target";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    product_key: "apple:iphone-13",
    reason: "user_scan",
    priority: 50,
    desired_currency: "EUR",
    enabled: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    last_refreshed_at: null,
    next_refresh_at: null,
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
    attempt_count: 0,
    last_error: null,
    last_success_at: null,
    consecutive_failures: 0,
    ...overrides,
  };
}

describe("claimResearchTargets", () => {
  it("réclame une cible due et libre, pose le bail avec l'échéance attendue", async () => {
    const supabase = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(supabase, () => NOW);
    supabase.seed("research_targets", [baseRow({ id: 1, next_refresh_at: null })]);

    const claimed = await claimResearchTargets(supabase as never, { leaseOwner: "worker-a", leaseDurationSeconds: 600 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.claimedBy).toBe("worker-a");
    expect(claimed[0]?.leaseExpiresAt).toBe(new Date(NOW.getTime() + 600_000).toISOString());
    expect(claimed[0]?.attemptCount).toBe(1);
  });

  it("un bail ACTIF ne peut jamais être volé par un autre bailleur", async () => {
    const supabase = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(supabase, () => NOW);
    supabase.seed("research_targets", [
      baseRow({ id: 1, next_refresh_at: null, claimed_by: "worker-a", lease_expires_at: new Date(NOW.getTime() + 600_000).toISOString() }),
    ]);

    const claimed = await claimResearchTargets(supabase as never, { leaseOwner: "worker-b", leaseDurationSeconds: 600 });
    expect(claimed).toEqual([]);
  });

  it("un bail EXPIRÉ redevient réclamable — récupération après crash workers sans intervention humaine", async () => {
    const supabase = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(supabase, () => NOW);
    supabase.seed("research_targets", [
      baseRow({ id: 1, next_refresh_at: null, claimed_by: "worker-a", lease_expires_at: new Date(NOW.getTime() - 1000).toISOString() }),
    ]);

    const claimed = await claimResearchTargets(supabase as never, { leaseOwner: "worker-b", leaseDurationSeconds: 600 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.claimedBy).toBe("worker-b");
  });

  it("deux workers séquentiels qui réclament chacun ne se recoupent jamais sur la même cible", async () => {
    const supabase = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(supabase, () => NOW);
    supabase.seed("research_targets", [baseRow({ id: 1, next_refresh_at: null }), baseRow({ id: 2, next_refresh_at: null })]);

    const first = await claimResearchTargets(supabase as never, { leaseOwner: "worker-a", leaseDurationSeconds: 600 });
    const second = await claimResearchTargets(supabase as never, { leaseOwner: "worker-b", leaseDurationSeconds: 600, limit: 2 });
    expect(first.map((r) => r.id)).toEqual([1]);
    expect(second.map((r) => r.id)).toEqual([2]);
  });

  it("n'acquiert jamais une cible désactivée ou future", async () => {
    const supabase = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(supabase, () => NOW);
    supabase.seed("research_targets", [
      baseRow({ id: 1, enabled: false, next_refresh_at: null }),
      baseRow({ id: 2, next_refresh_at: "2026-09-22T00:00:00.000Z" }),
    ]);

    const claimed = await claimResearchTargets(supabase as never, { leaseOwner: "worker-a", leaseDurationSeconds: 600, limit: 5 });
    expect(claimed).toEqual([]);
  });
});

describe("releaseResearchTarget", () => {
  it("libère un bail détenu — remet claimed_by/claimed_at/lease_expires_at à null", async () => {
    const supabase = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(supabase, () => NOW);
    supabase.seed("research_targets", [
      baseRow({ id: 1, claimed_by: "worker-a", claimed_at: NOW.toISOString(), lease_expires_at: new Date(NOW.getTime() + 600_000).toISOString() }),
    ]);

    const released = await releaseResearchTarget(supabase as never, 1, "worker-a");
    expect(released).toBe(true);
    const row = supabase.table("research_targets")[0];
    expect(row?.claimed_by).toBeNull();
    expect(row?.lease_expires_at).toBeNull();
  });

  it("ne libère JAMAIS le bail de quelqu'un d'autre — renvoie false sans modifier la ligne", async () => {
    const supabase = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(supabase, () => NOW);
    supabase.seed("research_targets", [
      baseRow({ id: 1, claimed_by: "worker-a", lease_expires_at: new Date(NOW.getTime() + 600_000).toISOString() }),
    ]);

    const released = await releaseResearchTarget(supabase as never, 1, "worker-b");
    expect(released).toBe(false);
    const row = supabase.table("research_targets")[0];
    expect(row?.claimed_by).toBe("worker-a");
  });
});
