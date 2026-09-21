import { describe, expect, it, vi } from "vitest";
import { createDataForSeoGoogleShoppingConnector } from "../connector";
import { ConnectorError } from "../../types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const POST_TASK_OK = { status_code: 20000, tasks: [{ id: "task-1", status_code: 20100, status_message: "Task Created.", cost: 0.001 }] };

function taskGetReady(items: unknown[]) {
  return { status_code: 20000, tasks: [{ id: "task-1", status_code: 20000, status_message: "Ok.", result: [{ keyword: "x", items }] }] };
}

const TASK_GET_NOT_READY = { status_code: 20000, tasks: [{ id: "task-1", status_code: 40601, status_message: "Task In Queue.", result: null }] };

describe("createDataForSeoGoogleShoppingConnector", () => {
  it("déclare retailPrices/search, jamais soldTransactions, et sourceKind='aggregator'", () => {
    const connector = createDataForSeoGoogleShoppingConnector({
      login: "l",
      password: "p",
      defaultLocationCode: 2756,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, POST_TASK_OK)),
    });
    expect(connector.evidenceTypes).toContain("retailPrices");
    expect(connector.evidenceTypes).not.toContain("soldTransactions");
    expect(connector.sourceKind).toBe("aggregator");
  });

  it("POST puis GET (tâche immédiatement prête) : normalise les résultats", async () => {
    const items = [{ title: "iPhone 13", price: 450, currency: "CHF", domain: "fnac.ch", product_id: "gp-1" }];
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, POST_TASK_OK)).mockResolvedValueOnce(jsonResponse(200, taskGetReady(items)));

    const connector = createDataForSeoGoogleShoppingConnector({ login: "l", password: "p", defaultLocationCode: 2756, fetchImpl });
    const result = await connector.search({ categorySlug: "apple", q: "iphone 13" });

    expect(result.observations).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("authentification HTTP Basic login:password", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, POST_TASK_OK)).mockResolvedValueOnce(jsonResponse(200, taskGetReady([])));
    const connector = createDataForSeoGoogleShoppingConnector({ login: "my-login", password: "my-password", defaultLocationCode: 2756, fetchImpl });

    await connector.search({ categorySlug: "apple", q: "iphone 13" });

    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("my-login:my-password").toString("base64")}`);
  });

  it("tâche jamais prête dans le délai imparti : résultat vide, jamais une exception (dégradation gracieuse)", async () => {
    let time = 0;
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
      time += 1;
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as never);

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, POST_TASK_OK))
      .mockImplementation(async () => jsonResponse(200, TASK_GET_NOT_READY));
    const connector = createDataForSeoGoogleShoppingConnector({ login: "l", password: "p", defaultLocationCode: 2756, fetchImpl, maxWaitMs: 5, pollIntervalMs: 1 });

    const result = await connector.search({ categorySlug: "apple", q: "iphone 13" });

    expect(result.observations).toEqual([]);
    vi.restoreAllMocks();
    void time;
  });

  it("signal externe abandonné PENDANT l'attente entre deux sondages (LOT 'Interactive History...', section 6) : rejette avec ConnectorError.aborted=true, jamais un résultat vide qui masquerait l'annulation", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      if ((init?.method ?? "GET") === "POST") return Promise.resolve(jsonResponse(200, POST_TASK_OK));
      return Promise.resolve(jsonResponse(200, TASK_GET_NOT_READY));
    }) as unknown as typeof fetch;

    const externalController = new AbortController();
    const connector = createDataForSeoGoogleShoppingConnector({
      login: "l",
      password: "p",
      defaultLocationCode: 2756,
      fetchImpl,
      maxWaitMs: 10_000,
      pollIntervalMs: 200,
    });

    const pending = connector.search({ categorySlug: "apple", q: "iphone 13", signal: externalController.signal });
    await new Promise((resolve) => setTimeout(resolve, 20)); // laisse POST + premier GET (not ready) s'exécuter, entre dans l'attente de sondage.
    externalController.abort();

    await expect(pending).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).aborted).toBe(true);
      return true;
    });
  });

  it("tâche refusée par DataForSEO (status_code d'erreur) : lève une ConnectorError, jamais un résultat vide silencieux", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { status_code: 20000, tasks: [{ id: "t", status_code: 40501, status_message: "Invalid Field." }] }));
    const connector = createDataForSeoGoogleShoppingConnector({ login: "l", password: "p", defaultLocationCode: 2756, fetchImpl });

    await expect(connector.search({ categorySlug: "apple", q: "x" })).rejects.toThrow(/Invalid Field/);
  });

  it("healthCheck() : down sur échec, jamais login/password dans le message", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(401, {}));
    const connector = createDataForSeoGoogleShoppingConnector({ login: "super-secret-login", password: "super-secret-password", defaultLocationCode: 2756, fetchImpl });

    const health = await connector.healthCheck();

    expect(health.status).toBe("down");
    expect(health.message).not.toContain("super-secret-login");
    expect(health.message).not.toContain("super-secret-password");
  });
});
