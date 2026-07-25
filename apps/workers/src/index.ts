import PgBoss from "pg-boss";
import { logger } from "./logger";
import { QUEUES, listingPayload } from "./queues";
import { scoreListing } from "./jobs/score-listing";

/**
 * Point d'entrée des workers.
 * pg-boss vit dans son schéma `pgboss` ; les contrats de jobs sont dans queues.ts.
 * Les handlers d'ingestion/normalisation s'enregistrent ici au Lot 3.
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

  logger.info("Workers démarrés — files actives : score.listing");

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
