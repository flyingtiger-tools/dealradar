import PgBoss from "pg-boss";
import { QUEUES, listingPayload, ingestSourcePayload } from "@dealradar/core";
import { createServiceClient } from "./db";
import { logger } from "./logger";
import { scoreListing } from "./jobs/score-listing";
import { buildEbayConnectorFromEnv } from "./ingestion/connector-config";
import { ingestAndAnalyze } from "./ingestion/ingest-and-analyze";

/**
 * Point d'entrée des workers.
 * pg-boss vit dans son schéma `pgboss` ; les contrats de jobs sont dans
 * @dealradar/core (queues.ts) — partagé avec apps/web, qui empile des jobs
 * `ingest.source` depuis la page admin sans jamais toucher aux secrets eBay
 * ni au service role (Lot 4, ADR 0008).
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL est requis pour démarrer les workers.");
  }

  const boss = new PgBoss({ connectionString, schema: "pgboss" });
  boss.on("error", (error) => logger.error({ error }, "Erreur pg-boss"));
  await boss.start();

  await boss.createQueue(QUEUES.scoreListing);
  await boss.work(QUEUES.scoreListing, async ([job]) => {
    if (!job) return;
    const payload = listingPayload.parse(job.data);
    await scoreListing(payload);
  });

  await boss.createQueue(QUEUES.ingestSource);
  await boss.work(QUEUES.ingestSource, async ([job]) => {
    if (!job) return;
    const payload = ingestSourcePayload.parse(job.data);
    const supabase = createServiceClient();
    const connector = buildEbayConnectorFromEnv();
    const result = await ingestAndAnalyze({
      supabase,
      connector,
      sourceSlug: payload.sourceSlug,
      categorySlug: payload.categorySlug,
      q: payload.q,
    });
    logger.info(result, "Ingestion (file) terminée");
  });

  logger.info("Workers démarrés — files actives : score.listing, ingest.source");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Arrêt des workers");
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.fatal({ error }, "Démarrage des workers impossible");
  process.exit(1);
});
