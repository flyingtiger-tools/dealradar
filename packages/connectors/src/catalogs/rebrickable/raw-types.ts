import { z } from "zod";

/**
 * Schéma Zod de `GET /api/v3/lego/sets/{set_num}/` — champs issus de la
 * forme PUBLIQUEMENT documentée et stable de longue date de l'API
 * Rebrickable v3 (confirmée par de multiples SDK/clients tiers open-source
 * — ex. pyrebrickable — et le blog officiel "Welcome to Rebrickable v3").
 *
 * HONNÊTETÉ (LOT "Free/Open Sources + Real Readiness + Live Smoke Tests",
 * section 4) : contrairement à TCGdex/Open Food Facts ce lot, AUCUN appel
 * réel authentifié n'a pu être effectué pour confirmer cette forme
 * directement — `REBRICKABLE_API_KEY` est absente de CET environnement
 * (confirmé : `GET /lego/sets/{set_num}/` sans clé renvoie `401
 * Unauthorized`, jamais un aperçu de réponse). Ce schéma reste donc "PRÊT
 * MAIS NON TESTÉ EN CONDITIONS RÉELLES" tant qu'un appel authentifié réel
 * n'aura pas confirmé chaque champ — voir `liveTested: false` dans le
 * descripteur du connecteur. Tous les champs sont `.optional()` par
 * prudence défensive plutôt que supposés systématiquement présents.
 */
export const rebrickableSetSchema = z.object({
  set_num: z.string(),
  name: z.string().optional(),
  year: z.number().optional(),
  theme_id: z.number().optional(),
  num_parts: z.number().optional(),
  set_img_url: z.string().nullable().optional(),
  set_url: z.string().optional(),
  last_modified_dt: z.string().optional(),
});
export type RebrickableSet = z.infer<typeof rebrickableSetSchema>;
