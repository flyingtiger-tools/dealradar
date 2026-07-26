import { z } from "zod";
import { itemConditionSchema } from "@dealradar/contracts";

/**
 * Un seul point de validation Zod pour tout ce qui sort d'un provider IA —
 * rien n'entre dans `merge()`/`extractProduct()` sans être passé ici.
 */

export const fieldSourceSchema = z.enum(["deterministic", "ai", "provided"]);
export type FieldSource = z.infer<typeof fieldSourceSchema>;

function attributeValueSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    confidence: z.number().min(0).max(1),
    source: fieldSourceSchema,
    evidence: z.string().optional(),
  });
}

const stringField = attributeValueSchema(z.string().min(1)).nullable();
const stringArrayField = attributeValueSchema(z.array(z.string())).nullable();
const conditionField = attributeValueSchema(itemConditionSchema).nullable();
const attributeBagValueSchema = attributeValueSchema(
  z.union([z.string(), z.number(), z.boolean()]),
).nullable();

/**
 * Forme finale garantie d'une extraction — utilisée en interne par
 * `merge()` et par tout consommateur qui veut revalider une valeur avant
 * de la faire entrer dans `attributes`. `serialNumberDetected` est le
 * **seul** champ lié au numéro de série : aucun autre champ de ce nom
 * n'existe dans ce schéma (numéro complet jamais stocké — correction 4).
 */
export const extractedProductSchema = z.object({
  brand: stringField,
  model: stringField,
  reference: stringField,
  category: stringField,
  subcategory: stringField,
  condition: conditionField,
  language: stringField,
  color: stringField,
  capacity: stringField,
  accessories: stringArrayField,
  serialNumberDetected: attributeValueSchema(z.boolean()),
  attributes: z.record(attributeBagValueSchema),
});
export type ExtractedProduct = z.infer<typeof extractedProductSchema>;

/**
 * Réponse brute d'un provider IA, avant fusion — champs optionnels car un
 * modèle peut légitimement omettre un champ qu'il ne détecte pas. `condition`
 * reste une simple chaîne ici : elle n'est acceptée comme `ItemCondition`
 * qu'après revalidation explicite dans `merge.ts` (une valeur non reconnue
 * devient `null`, jamais une supposition — même philosophie que le mapping
 * de condition eBay de l'ADR 0008).
 */
export const rawProviderResponseSchema = z.object({
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  capacity: z.string().nullable().optional(),
  accessories: z.array(z.string()).nullable().optional(),
  serialNumberDetected: z.boolean().nullable().optional(),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  confidence: z.record(z.number().min(0).max(1)).optional(),
});
export type RawProviderResponse = z.infer<typeof rawProviderResponseSchema>;
