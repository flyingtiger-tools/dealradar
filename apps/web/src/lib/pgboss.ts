import PgBoss from "pg-boss";

/**
 * Empile un job pg-boss depuis apps/web — jamais `.work()` ici, uniquement
 * `.send()`. Utilise `DATABASE_URL_ENQUEUE` (rôle Postgres restreint
 * `dealradar_enqueue`, aucun accès au schéma public) — jamais `DATABASE_URL`
 * complet. Pool à `max: 1`, connexion fermée après chaque envoi : évite
 * l'accumulation de connexions entre invocations (voir ADR 0008, durcissement
 * §1). Tant que `DATABASE_URL_ENQUEUE` n'est pas configurée (rôle non encore
 * activé manuellement), cette fonction échoue explicitement — jamais de
 * repli silencieux vers une autre connexion.
 */
export async function enqueueJob(queueName: string, data: Record<string, unknown>): Promise<void> {
  const connectionString = process.env.DATABASE_URL_ENQUEUE;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_ENQUEUE n'est pas configurée. Le rôle Postgres restreint dealradar_enqueue doit être activé " +
        "manuellement (voir ADR 0008) avant de pouvoir déclencher une ingestion depuis cette page.",
    );
  }

  const boss = new PgBoss({ connectionString, schema: "pgboss", max: 1 });
  boss.on("error", (error) => {
    console.error("pg-boss (enqueue) :", error.message);
  });

  try {
    await boss.start();
    await boss.send(queueName, data);
  } finally {
    await boss.stop({ graceful: false, timeout: 5000 }).catch(() => undefined);
  }
}
