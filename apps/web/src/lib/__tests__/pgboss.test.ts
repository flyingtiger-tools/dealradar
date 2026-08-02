import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockStart = vi.fn();
const mockSend = vi.fn();
const mockStop = vi.fn();
const mockOn = vi.fn();
const PgBossMock = vi.fn().mockImplementation(() => ({
  start: mockStart,
  send: mockSend,
  stop: mockStop,
  on: mockOn,
}));

vi.mock("pg-boss", () => ({
  default: PgBossMock,
}));

/**
 * `enqueueJob` (apps/web) est un producteur pg-boss — jamais responsable de
 * créer ou migrer le schéma `pgboss` (seul le worker, propriétaire du
 * schéma, doit le faire). Ces tests vérifient le comportement observable de
 * l'adaptateur, pas l'implémentation interne de pg-boss lui-même.
 */
describe("enqueueJob", () => {
  const ORIGINAL_ENV = process.env.DATABASE_URL_ENQUEUE;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStart.mockResolvedValue(undefined);
    mockSend.mockResolvedValue("job-id");
    mockStop.mockResolvedValue(undefined);
    process.env.DATABASE_URL_ENQUEUE = "postgresql://dealradar_enqueue:x@host:5432/postgres";
  });

  afterEach(() => {
    process.env.DATABASE_URL_ENQUEUE = ORIGINAL_ENV;
  });

  it("ne demande jamais au producteur de créer ou migrer le schéma pgboss (migrate: false)", async () => {
    const { enqueueJob } = await import("../pgboss");
    await enqueueJob("ingest.source", { foo: "bar" });

    expect(PgBossMock).toHaveBeenCalledTimes(1);
    const options = PgBossMock.mock.calls[0]![0];
    expect(options.migrate).toBe(false);
  });

  it("flux nominal : démarre la connexion puis envoie le job, dans cet ordre", async () => {
    const { enqueueJob } = await import("../pgboss");
    await enqueueJob("ingest.source", { foo: "bar" });

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith("ingest.source", { foo: "bar" });

    const startOrder = mockStart.mock.invocationCallOrder[0]!;
    const sendOrder = mockSend.mock.invocationCallOrder[0]!;
    expect(startOrder).toBeLessThan(sendOrder);
  });

  it("ferme systématiquement la connexion après l'envoi (jamais de pool persistant réutilisé entre appels)", async () => {
    const { enqueueJob } = await import("../pgboss");
    await enqueueJob("ingest.source", { foo: "bar" });

    expect(mockStop).toHaveBeenCalledTimes(1);
    const options = PgBossMock.mock.calls[0]![0];
    expect(options.max).toBe(1);
  });

  it("DATABASE_URL_ENQUEUE absente : refuse explicitement, jamais un pg-boss construit ou une autre connexion utilisée", async () => {
    delete process.env.DATABASE_URL_ENQUEUE;
    const { enqueueJob } = await import("../pgboss");

    await expect(enqueueJob("ingest.source", { foo: "bar" })).rejects.toThrow(/DATABASE_URL_ENQUEUE/);
    expect(PgBossMock).not.toHaveBeenCalled();
  });

  it("n'active jamais la migration par défaut, même si un futur appel omettait explicitement l'option", async () => {
    const { enqueueJob } = await import("../pgboss");
    await enqueueJob("ingest.source", { foo: "bar" });

    const options = PgBossMock.mock.calls[0]![0];
    expect(options).toHaveProperty("migrate", false);
    expect(options.migrate).not.toBeUndefined();
  });
});
