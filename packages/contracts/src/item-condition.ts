import { z } from "zod";

/**
 * Source de vérité unique pour l'état d'un article, partagée par tous les
 * paquets DealRadar (core, ai, connectors, ingestion) — jamais redéfinie
 * localement ailleurs.
 */
export const itemConditionSchema = z.enum([
  "new",
  "like_new",
  "very_good",
  "good",
  "fair",
  "for_parts",
]);

export type ItemCondition = z.infer<typeof itemConditionSchema>;
