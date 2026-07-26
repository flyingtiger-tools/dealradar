/**
 * Données déclaratives consommées par `deterministic-extractor.ts` — même
 * esprit que `category-profiles.ts` du Lot 3 : les motifs vivent ici, la
 * seule branche par catégorie est le `Record` de dispatch dans
 * `deterministic-extractor.ts`, jamais dispersée ailleurs.
 */

export const APPLE_PRODUCT_LINES = [
  "iPhone",
  "MacBook Pro",
  "MacBook Air",
  "MacBook",
  "iPad Pro",
  "iPad Air",
  "iPad mini",
  "iPad",
  "iMac",
  "Apple Watch",
  "AirPods Pro",
  "AirPods Max",
  "AirPods",
] as const;

export const GAMING_PLATFORMS = [
  "PS5",
  "PS4",
  "PS3",
  "PlayStation 5",
  "PlayStation 4",
  "Xbox Series X",
  "Xbox Series S",
  "Xbox One",
  "Nintendo Switch OLED",
  "Nintendo Switch",
  "Switch",
  "Wii U",
  "Wii",
  "Nintendo 3DS",
  "GameCube",
  "PS Vita",
  "PSP",
] as const;

export const PHOTO_BRANDS = ["Canon", "Nikon", "Sony", "Fujifilm", "Olympus", "Panasonic", "Leica"] as const;
export const PHOTO_LENS_KEYWORDS = [/objectif/i, /\blens\b/i, /focale/i];
