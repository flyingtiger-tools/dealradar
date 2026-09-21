import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getDbIntegrationConfig } from "./env";
import { ensureTestMigrationsApplied, cleanupTestRows } from "./apply-migrations";
import { claimResearchTargets, releaseResearchTarget } from "../../claim-research-target";

/**
 * INTÉGRATION DB RÉELLE (LOT "Real DB Integration + Exact Budget
 * Enforcement + Runtime Observability", section 2) — jamais exécuté sans
 * `ALLOW_DB_INTEGRATION_TESTS=true` + `TEST_DATABASE_URL` +
 * `TEST_DATABASE_SUPABASE_URL` + `TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY`
 * (voir `env.ts`). Sans ces variables, `describe.skipIf` marque cette
 * suite entière comme SKIPPED — jamais un échec silencieux, jamais un
 * "passed" fabriqué en leur absence.
 *
 * Prouve contre une VRAIE Postgres (via `claim_research_target`, migration
 * 0021, appelée exactement comme en production via `claimResearchTargets`)
 * ce qu'un double `FakeSupabase` mono-thread ne peut JAMAIS prouver :
 * l'atomicité réelle de `FOR UPDATE SKIP LOCKED` sous deux connexions
 * Postgres indépendantes concurrentes.
 */
const config = getDbIntegrationConfig();
const TEST_KEY_PREFIX = "db-integration-test:claim:";

function testProductKey(suffix: string): string {
  return `${TEST_KEY_PREFIX}${suffix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function seedTarget(pgClient: Client, productKey: string, overrides: Partial<{ priority: number; nextRefreshAt: string | null; enabled: boolean }> = {}): Promise<number> {
  const result = await pgClient.query<{ id: number }>(
    `insert into public.research_targets (product_key, reason, priority, desired_currency, enabled, next_refresh_at)
     values ($1, 'manual_seed', $2, 'CHF', $3, $4)
     returning id`,
    [productKey, overrides.priority ?? 50, overrides.enabled ?? true, overrides.nextRefreshAt === undefined ? null : overrides.nextRefreshAt],
  );
  return result.rows[0]!.id;
}

describe.skipIf(!config)("claim_research_target / release_research_target — INTÉGRATION DB RÉELLE", () => {
  let pgClient: Client;
  let supabaseA: SupabaseClient;
  let supabaseB: SupabaseClient;

  beforeAll(async () => {
    if (!config) return;
    pgClient = new Client({ connectionString: config.postgresConnectionString });
    await pgClient.connect();
    await ensureTestMigrationsApplied(pgClient);
    supabaseA = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false } });
    supabaseB = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false } });
  });

  afterAll(async () => {
    if (!config) return;
    await cleanupTestRows(pgClient, TEST_KEY_PREFIX);
    await pgClient.end();
  });

  it("deux connexions réclamant SIMULTANÉMENT plusieurs cibles dues ne réclament JAMAIS la même cible deux fois (SKIP LOCKED)", async () => {
    const keys = Array.from({ length: 6 }, (_, i) => testProductKey(`concurrent-${i}`));
    for (const key of keys) await seedTarget(pgClient, key);

    const [claimedA, claimedB] = await Promise.all([
      claimResearchTargets(supabaseA, { leaseOwner: "conn-a", leaseDurationSeconds: 60, limit: 6 }),
      claimResearchTargets(supabaseB, { leaseOwner: "conn-b", leaseDurationSeconds: 60, limit: 6 }),
    ]);

    const idsA = claimedA.map((t) => t.id);
    const idsB = claimedB.map((t) => t.id);
    const overlap = idsA.filter((id) => idsB.includes(id));

    expect(overlap).toEqual([]);
    expect(new Set([...idsA, ...idsB]).size).toBe(idsA.length + idsB.length);
    expect(idsA.length + idsB.length).toBe(6); // les 6 cibles dues ont bien été réparties, aucune perdue, aucune dupliquée.
  });

  it("un bail ACTIF ne peut jamais être volé par une autre connexion", async () => {
    const key = testProductKey("active-lease");
    await seedTarget(pgClient, key);

    const first = await claimResearchTargets(supabaseA, { leaseOwner: "conn-a", leaseDurationSeconds: 60, limit: 1 });
    expect(first).toHaveLength(1);

    const second = await claimResearchTargets(supabaseB, { leaseOwner: "conn-b", leaseDurationSeconds: 60, limit: 1 });
    expect(second.find((t) => t.id === first[0]!.id)).toBeUndefined();
  });

  it("un bail EXPIRÉ redevient réclamable par une autre connexion — récupération après crash sans intervention humaine", async () => {
    const key = testProductKey("expired-lease");
    await seedTarget(pgClient, key);

    const first = await claimResearchTargets(supabaseA, { leaseOwner: "conn-a", leaseDurationSeconds: 1, limit: 1 });
    expect(first).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 1500)); // laisse le bail expirer réellement (durée posée à 1s ci-dessus).

    const second = await claimResearchTargets(supabaseB, { leaseOwner: "conn-b", leaseDurationSeconds: 60, limit: 1 });
    expect(second.find((t) => t.id === first[0]!.id)?.claimedBy).toBe("conn-b");
  });

  it("release ne fonctionne QUE pour le bailleur propriétaire — renvoie false sans effet pour un autre bailleur", async () => {
    const key = testProductKey("release-ownership");
    await seedTarget(pgClient, key);
    const claimed = await claimResearchTargets(supabaseA, { leaseOwner: "conn-a", leaseDurationSeconds: 60, limit: 1 });
    const targetId = claimed[0]!.id;

    const releasedByWrongOwner = await releaseResearchTarget(supabaseB, targetId, "conn-b");
    expect(releasedByWrongOwner).toBe(false);

    const releasedByOwner = await releaseResearchTarget(supabaseA, targetId, "conn-a");
    expect(releasedByOwner).toBe(true);
  });

  it("simulation de crash workers (jamais de release explicite) — la cible est récupérée par une autre connexion après expiration du bail, jamais bloquée définitivement", async () => {
    const key = testProductKey("crash-recovery");
    await seedTarget(pgClient, key);

    const crashed = await claimResearchTargets(supabaseA, { leaseOwner: "conn-crashed", leaseDurationSeconds: 1, limit: 1 });
    expect(crashed).toHaveLength(1);
    // Aucun releaseResearchTarget appelé ici — simule un worker qui crashe avant de libérer son bail.

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const recovered = await claimResearchTargets(supabaseB, { leaseOwner: "conn-recovery", leaseDurationSeconds: 60, limit: 1 });
    expect(recovered.find((t) => t.id === crashed[0]!.id)?.claimedBy).toBe("conn-recovery");
  });
});
