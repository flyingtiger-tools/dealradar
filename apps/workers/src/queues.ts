import { z } from "zod";

/**
 * Contrats des files de jobs (ADR 0003).
 * Les handlers dépendent de ces contrats, jamais de pg-boss directement :
 * la file est remplaçable (BullMQ/Redis) sans toucher au métier.
 */
export const QUEUES = {
  /** Récupérer les nouvelles annonces d'une source. */
  ingestSource: "ingest.source",
  /** Normaliser une annonce brute : taxonomie, attributs, embedding. */
  normalizeListing: "normalize.listing",
  /** Recalculer comparables + scores d'une annonce. */
  scoreListing: "score.listing",
  /** Évaluer les alertes utilisateur impactées par une annonce. */
  evaluateAlerts: "alerts.evaluate",
} as const;

export const ingestSourcePayload = z.object({
  sourceSlug: z.string(),
  categoryPath: z.string().optional(),
});
export type IngestSourcePayload = z.infer<typeof ingestSourcePayload>;

export const listingPayload = z.object({ listingId: z.string().uuid() });
export type ListingPayload = z.infer<typeof listingPayload>;
