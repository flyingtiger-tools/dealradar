import { z } from "zod";

/**
 * Catégories supportées par Intelligence Core — source de vérité unique,
 * partagée par tous les paquets. `packages/core` ré-exporte ce type sous le
 * nom historique `CategoryProfileSlug` pour ne casser aucun import existant.
 *
 * 5 catégories d'origine (Lot 3) : `lego`, `pokemon_tcg`, `apple`, `gaming`,
 * `photo`. Étendu (LOT "Universal Object Valuation Foundation",
 * 2026-09-20) avec `sneakers`, `watches`, `pc_components`, `collectibles`
 * (objets de collection génériques, hors TCG — pièces, timbres, comics,
 * memorabilia) et `general` (catégorie de repli explicite pour un objet non
 * couvert par un profil plus spécifique — voir `category-profiles.ts` :
 * volontairement peu exigeante, jamais un blocage sur une catégorie
 * simplement absente de cette liste).
 */
export const categorySlugSchema = z.enum([
  "lego",
  "pokemon_tcg",
  "apple",
  "gaming",
  "photo",
  "sneakers",
  "watches",
  "pc_components",
  "collectibles",
  "general",
]);

export type CategorySlug = z.infer<typeof categorySlugSchema>;
