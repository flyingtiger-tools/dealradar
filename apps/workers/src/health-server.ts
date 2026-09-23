import { createServer, type Server } from "node:http";
import { logger } from "./logger";

/**
 * Serveur HTTP de santé MINIMAL (LOT "Back4App Migration — Minimal Worker
 * Compatibility Fix") — `apps/workers` est un worker pg-boss pur, il
 * n'écoutait jusqu'ici sur AUCUN port HTTP. Back4App Containers effectue
 * un contrôle de port/health check ; sans ce serveur, le service serait
 * tué même si le worker pg-boss démarre correctement.
 *
 * Volontairement un simple probe de VIVACITÉ (le processus répond),
 * jamais un probe d'ÉTAT du worker pg-boss lui-même (aucune donnée
 * métier, aucune connexion base — `node:http` natif uniquement, aucune
 * dépendance ajoutée). Ne remplace jamais le démarrage du worker
 * pg-boss, ne l'affecte jamais — appelé en tout début de `main()`,
 * indépendamment du reste.
 */
const HEALTH_BODY = JSON.stringify({ status: "ok" });

/**
 * `host` par défaut `0.0.0.0` (exigence Back4App — jamais changé par
 * `index.ts`, qui n'appelle cette fonction sans argument). Paramètre
 * exposé UNIQUEMENT pour les tests : `0.0.0.0` en écoute puis une
 * connexion à `127.0.0.1` échoue avec `EADDRNOTAVAIL` sur certaines
 * configurations réseau Windows (constaté ce lot) — jamais un problème
 * réel sur le conteneur Linux cible, mais les tests écoutent directement
 * sur `127.0.0.1` pour rester fiables partout.
 */
export function startHealthServer(port: number = Number(process.env.PORT) || 8080, host = "0.0.0.0"): Server {
  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(HEALTH_BODY);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, host, () => {
    logger.info({ port, host }, "Serveur de santé HTTP démarré");
  });

  return server;
}

/** Fermeture propre — jamais un `process.exit` forcé qui couperait une réponse HTTP déjà en cours. */
export function stopHealthServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
