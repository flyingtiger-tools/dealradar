import { z } from "zod";

/**
 * Enveloppe Zod du résultat d'analyse pour un scan photo de carte Pokémon
 * (LOT 8, mobile) — distincte de `analysisResultSchema` (générique,
 * décision BUY/REVIEW/PASS via Intelligence Core) : ce flux n'exprime
 * volontairement aucune décision, seulement une identité de carte
 * corroborée et des observations de prix traçables par source, exactement
 * la forme déjà produite par `orchestratePokemonPipeline()`
 * (`@dealradar/ingestion`, LOT 3-7C) — reflétée ici sans être importée
 * (même règle que `analysisResultSchema` : `@dealradar/contracts` ne
 * dépend jamais de `@dealradar/ingestion`).
 *
 * `kind: "pokemon_tcg_card"` distingue ce résultat de `analysisResultSchema`
 * dans l'union `analysisResponseSchema.result` — un client mobile qui reçoit
 * ce `kind` sait immédiatement quel écran de résultat afficher.
 */

export const tcgCardExtractedFieldsSchema = z.object({
  category: z.literal("pokemon_tcg"),
  game: z.string().nullable(),
  cardName: z.string().nullable(),
  setName: z.string().nullable(),
  cardNumber: z.string().nullable(),
  variant: z.string().nullable(),
  language: z.string().nullable(),
  productKind: z.enum(["raw_card", "graded_card"]).nullable(),
  gradingCompany: z.string().nullable(),
  grade: z.string().nullable(),
  /** Confiance globale de l'extraction visuelle — jamais celle de l'identité catalogue corroborée (champ séparé ci-dessous, jamais mélangés). */
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type TcgCardExtractedFields = z.infer<typeof tcgCardExtractedFieldsSchema>;

/** Hints corrigés manuellement par l'utilisateur sur l'écran de confirmation — mêmes noms de champs que `tcgCardExtractedFieldsSchema`, jamais une seconde forme. */
export const tcgCardProvidedHintsSchema = z.object({
  cardName: z.string().min(1).nullable(),
  setName: z.string().min(1).nullable(),
  cardNumber: z.string().min(1).nullable(),
  variant: z.string().min(1).nullable(),
  language: z.string().min(1).nullable(),
  productKind: z.enum(["raw_card", "graded_card"]).nullable(),
  gradingCompany: z.string().min(1).nullable(),
  grade: z.string().min(1).nullable(),
});
export type TcgCardProvidedHints = z.infer<typeof tcgCardProvidedHintsSchema>;

const tcgPriceConversionSchema = z.object({
  originalAmountCents: z.number(),
  originalCurrency: z.string().length(3),
  rate: z.number(),
  rateDate: z.string(),
  convertedAmountCents: z.number(),
  convertedCurrency: z.string().length(3),
  warning: z.string(),
});

export const tcgPriceObservationSchema = z.object({
  source: z.string(),
  provenance: z.string(),
  amountCents: z.number(),
  currency: z.string().length(3),
  condition: z.string().nullable(),
  variant: z.string().nullable(),
  language: z.string().nullable(),
  gradingCompany: z.string().nullable(),
  grade: z.string().nullable(),
  region: z.string(),
  updatedAt: z.string().nullable(),
  /** Conversion indicative vers la devise cible (CHF) — `null` si déjà native ou si la conversion a échoué (voir `warnings`). Jamais une moyenne, jamais un remplacement du montant natif ci-dessus. */
  conversion: tcgPriceConversionSchema.nullable(),
  warnings: z.array(z.string()),
});
export type TcgPriceObservation = z.infer<typeof tcgPriceObservationSchema>;

export const tcgCardIdentitySchema = z.object({
  catalogExternalId: z.string(),
  game: z.string(),
  name: z.string(),
  setName: z.string().nullable(),
  cardNumber: z.string().nullable(),
  /** `null` si plusieurs variantes distinctes coexistent sans être départagées — jamais une valeur arbitraire (voir `priceObservations` pour le détail segmenté). */
  variant: z.string().nullable(),
  language: z.string().nullable(),
  productKind: z.string(),
  gradingCompany: z.string().nullable(),
  grade: z.string().nullable(),
  /** Confiance de l'identité catalogue (corroborée par deux sources ou non) — jamais influencée par le nombre d'observations de prix. */
  confidence: z.number().min(0).max(1),
  catalogCorroboration: z.enum(["corroborated", "single_source", "single_catalog_source", "diverged"]),
});
export type TcgCardIdentity = z.infer<typeof tcgCardIdentitySchema>;

export const tcgCardAnalysisResultSchema = z.object({
  kind: z.literal("pokemon_tcg_card"),
  /**
   * `true` si l'extraction visuelle est trop incertaine ou incomplète pour
   * lancer la corroboration automatiquement — le client doit alors afficher
   * un écran de confirmation (champs détectés, éditables) plutôt qu'un
   * résultat. Jamais une correspondance automatique sur un nom seul ou une
   * confiance faible (voir ADR 0012/LOT 3).
   */
  needsConfirmation: z.boolean(),
  extractedFields: tcgCardExtractedFieldsSchema,
  /** `null` tant qu'aucune identité n'a été corroborée (confirmation en attente, ou refus catalogue/pricing). */
  identity: tcgCardIdentitySchema.nullable(),
  /** Jamais moyennées entre elles — une entrée par (source × segment) accepté. Vide si `identity` est `null`. */
  priceObservations: z.array(tcgPriceObservationSchema),
  warnings: z.array(z.string()),
  /** Raison lisible du refus/de l'arrêt, quand `identity` est `null` et `needsConfirmation` est `false` (ex. divergence catalogue, aucun exact_match pricing). */
  reason: z.string().nullable(),
});
export type TcgCardAnalysisResult = z.infer<typeof tcgCardAnalysisResultSchema>;
