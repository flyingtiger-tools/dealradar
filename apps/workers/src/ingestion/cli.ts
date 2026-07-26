import { createServiceClient } from "../db";
import { logger } from "../logger";
import { buildEbayConnectorFromEnv } from "./connector-config";
import { ingestAndAnalyze } from "./ingest-and-analyze";

/**
 * Commande de test manuelle (Lot 4, point 5) — aucune planification :
 *   pnpm --filter @dealradar/workers ingest -- --category lego --q "lego star wars"
 */
function parseArgs(argv: string[]): { categorySlug: string; q: string } {
  let categorySlug: string | undefined;
  let q: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--category") categorySlug = argv[i + 1];
    if (argv[i] === "--q") q = argv[i + 1];
  }

  if (!categorySlug || !q) {
    throw new Error('Usage : --category <lego|pokemon_tcg|apple|gaming|photo> --q "texte de recherche"');
  }
  return { categorySlug, q };
}

async function main() {
  const { categorySlug, q } = parseArgs(process.argv.slice(2));
  const supabase = createServiceClient();
  const connector = buildEbayConnectorFromEnv();

  logger.info({ categorySlug, q }, "Ingestion manuelle démarrée");
  const result = await ingestAndAnalyze({ supabase, connector, sourceSlug: "ebay", categorySlug, q });
  logger.info(result, "Ingestion manuelle terminée");
}

main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : "erreur inconnue" }, "Ingestion manuelle en échec");
  process.exit(1);
});
