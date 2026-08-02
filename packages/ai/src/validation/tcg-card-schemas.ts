import { z } from "zod";

/**
 * Réponse brute du provider IA pour le scan photo TCG (LOT 8) — distincte de
 * `rawProviderResponseSchema` (schéma générique produit/marketplace) : champs
 * différents, même discipline (tout optionnel, un modèle peut légitimement
 * omettre un champ qu'il ne détecte pas ; jamais revalidé comme une
 * certitude avant passage par `extract-tcg-card.ts`).
 */
export const rawTcgCardProviderResponseSchema = z.object({
  game: z.string().nullable().optional(),
  cardName: z.string().nullable().optional(),
  setName: z.string().nullable().optional(),
  cardNumber: z.string().nullable().optional(),
  variant: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  productKind: z.enum(["raw_card", "graded_card"]).nullable().optional(),
  gradingCompany: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  overallConfidence: z.number().min(0).max(1).optional(),
  confidence: z.record(z.number().min(0).max(1)).optional(),
});
export type RawTcgCardProviderResponse = z.infer<typeof rawTcgCardProviderResponseSchema>;
