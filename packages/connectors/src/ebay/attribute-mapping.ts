import type { EbayRawAspect } from "./raw-types";

/**
 * Correspondance eBay "item specifics" (`localizedAspects`) → clés
 * d'attribut DealRadar (LOT "Données marché réelles + préparation E2E").
 * Résout la limite documentée depuis le LOT "Universal Object Valuation
 * Foundation" (voir `normalize.ts`, ADR 0008) : jusqu'ici, `attributes`
 * reprenait les noms bruts eBay tels quels (`"Set Number"`), jamais alignés
 * sur les clés attendues par `CategoryProfile.similarityAttributeKeys`
 * (`setNumber`), donc `matchComparables()` ne pouvait structurellement
 * jamais les faire correspondre à un candidat eBay.
 *
 * Volontairement CONSERVATEUR : seuls des noms d'aspect eBay SPÉCIFIQUES et
 * non-ambigus sont mappés (jamais un nom générique comme "Type" ou "Model
 * Number", utilisé différemment selon la catégorie — un mapping erroné
 * ferait correspondre deux attributs différents sous une même clé, pire
 * qu'aucune correspondance). Un aspect non reconnu n'est JAMAIS perdu : il
 * reste disponible sous son nom brut normalisé (minuscules/trim), jamais
 * une valeur inventée ni un aspect silencieusement supprimé.
 */

/** Clé DealRadar -> variantes de noms d'aspect eBay reconnues (déjà en minuscules/trim pour la comparaison). */
const ASPECT_NAME_ALIASES: Record<string, readonly string[]> = {
  brand: ["brand", "manufacturer"],
  model: ["model", "model name", "series"],
  mpn: ["mpn", "manufacturer part number"],
  storageGb: ["storage capacity", "capacity", "hard drive capacity"],
  color: ["color", "colour"],
  size: ["size", "shoe size", "us shoe size", "uk shoe size", "eu shoe size"],
  generation: ["generation", "model generation"],
  ean: ["ean"],
  upc: ["upc"],
  region: ["region", "country/region of manufacture", "region of manufacture"],
  language: ["language"],
  setNumber: ["set number", "lego set number"],
  piecesCount: ["number of pieces", "pieces", "piece count"],
  platform: ["platform", "console", "compatible platform"],
  productName: ["game name", "product name"],
  gearType: ["camera type", "lens type"],
  mount: ["lens mount", "mount"],
  componentType: ["component type"],
  itemType: ["object type"],
};

/** Inversé une fois au chargement du module : nom d'aspect eBay (minuscule/trim) -> clé DealRadar. */
const ALIAS_TO_KEY = new Map<string, string>();
for (const [key, aliases] of Object.entries(ASPECT_NAME_ALIASES)) {
  for (const alias of aliases) ALIAS_TO_KEY.set(alias, key);
}

/** Unités de capacité reconnues, jamais une supposition quand l'unité est absente (voir `parseStorageValue`). */
const STORAGE_UNIT_TO_GB: Record<string, number> = { mb: 1 / 1024, gb: 1, tb: 1024 };

/**
 * `"256 GB"`/`"256GB"`/`"1 TB"` → nombre de Go. Sans unité reconnue dans la
 * valeur, retourne `null` (jamais une unité devinée) — la valeur brute reste
 * alors disponible telle quelle via le repli générique de
 * `normalizeEbayAspects`.
 */
function parseStorageGb(value: string): number | null {
  const match = /^(\d+(?:[.,]\d+)?)\s*(mb|gb|tb)$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]!.replace(",", "."));
  const unit = match[2]!.toLowerCase();
  if (!Number.isFinite(amount)) return null;
  const gb = amount * STORAGE_UNIT_TO_GB[unit]!;
  return Number.isInteger(gb) ? gb : Math.round(gb * 1000) / 1000;
}

/** `"1,000"`/`"1000"` → nombre entier. Toute autre forme (plage, texte) retourne `null`, jamais une supposition. */
function parseWholeNumber(value: string): number | null {
  const cleaned = value.trim().replace(/[,'\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeAspectValue(key: string, rawValue: string): string | number {
  const trimmed = rawValue.trim();
  if (key === "storageGb") return parseStorageGb(trimmed) ?? trimmed.toLowerCase();
  if (key === "piecesCount") return parseWholeNumber(trimmed) ?? trimmed.toLowerCase();
  return trimmed.toLowerCase();
}

/**
 * `localizedAspects` (eBay) -> `attributes` (DealRadar), utilisée par
 * `normalize.ts`. Un aspect reconnu (voir `ASPECT_NAME_ALIASES`) est stocké
 * sous sa clé canonique DealRadar ; un aspect non reconnu reste disponible
 * sous son propre nom (minuscules/trim, jamais perdu) — jamais un mapping
 * incertain forcé sur une clé de profil.
 */
export function normalizeEbayAspects(aspects: readonly EbayRawAspect[] | undefined): Record<string, string | number> {
  const attributes: Record<string, string | number> = {};
  for (const aspect of aspects ?? []) {
    if (!aspect.name || aspect.value === undefined) continue;
    const rawName = aspect.name.trim();
    if (rawName === "" || aspect.value.trim() === "") continue;

    const canonicalKey = ALIAS_TO_KEY.get(rawName.toLowerCase());
    const key = canonicalKey ?? rawName.toLowerCase();
    attributes[key] = normalizeAspectValue(key, aspect.value);
  }
  return attributes;
}
