import { z } from "zod";

/**
 * Contrats des files de jobs (ADR 0003).
 * Les handlers dépendent de ces contrats, jamais de pg-boss directement :
 * la file est remplaçable (BullMQ/Redis) sans toucher au métier.
 *
 * Vit dans @dealradar/core (pas dans apps/workers) : depuis le Lot 4,
 * apps/web doit pouvoir empiler un job `ingestSource` (page admin) sans
 * dépendre d'apps/workers — ce fichier n'a aucune dépendance DB/IO, sa
 * place est le paquet déjà partagé par les deux apps.
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
  /** Un des 5 slugs de profil de catégorie (lego, pokemon_tcg, apple, gaming, photo). */
  categorySlug: z.string().min(1),
  q: z.string().min(1),
});
export type IngestSourcePayload = z.infer<typeof ingestSourcePayload>;

export const listingPayload = z.object({ listingId: z.string().uuid() });
export type ListingPayload = z.infer<typeof listingPayload>;
