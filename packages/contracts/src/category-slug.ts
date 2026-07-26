import { z } from "zod";

/**
 * Les 5 catégories supportées par Intelligence Core (Lot 3) — source de
 * vérité unique, partagée par tous les paquets. `packages/core` ré-exporte
 * ce type sous le nom historique `CategoryProfileSlug` pour ne casser aucun
 * import existant.
 */
export const categorySlugSchema = z.enum(["lego", "pokemon_tcg", "apple", "gaming", "photo"]);

export type CategorySlug = z.infer<typeof categorySlugSchema>;
