import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { startHealthServer, stopHealthServer } from "../health-server";

/** Attend l'évènement "listening" réel avant de lire `server.address()` — `.listen()` est asynchrone, le lire trop tôt renvoie `null`/un port périmé. */
function waitListening(server: Server): Promise<Server> {
  return new Promise((resolve) => server.once("listening", () => resolve(server)));
}

async function startAndWait(port: number, host?: string): Promise<Server> {
  const server = startHealthServer(port, host);
  return waitListening(server);
}

describe("startHealthServer", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await stopHealthServer(server);
    server = undefined;
  });

  function baseUrl(): string {
    const address = server!.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    return `http://127.0.0.1:${port}`;
  }

  it("écoute sur 0.0.0.0 par défaut (aucun host explicite) — exigence Back4App", async () => {
    server = await startAndWait(0);
    const address = server.address();
    expect(typeof address === "object" && address !== null ? address.address : null).toBe("0.0.0.0");
  });

  it("GET / renvoie 200 avec une réponse JSON minimale", async () => {
    server = await startAndWait(0, "127.0.0.1"); // port 0 = choisi par l'OS, jamais un conflit entre tests
    const res = await fetch(`${baseUrl()}/`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /health renvoie la même réponse", async () => {
    server = await startAndWait(0, "127.0.0.1");
    const res = await fetch(`${baseUrl()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("une route inconnue renvoie 404, jamais un crash", async () => {
    server = await startAndWait(0, "127.0.0.1");
    const res = await fetch(`${baseUrl()}/unknown`);
    expect(res.status).toBe(404);
  });

  it("stopHealthServer ferme réellement le serveur — un appel suivant échoue", async () => {
    server = await startAndWait(0, "127.0.0.1");
    const url = baseUrl();
    await stopHealthServer(server);
    await expect(fetch(url)).rejects.toThrow();
    server = undefined; // déjà fermé, jamais refermé dans afterEach
  });
});
