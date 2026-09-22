import type { CatalogItem, CatalogMatch } from "../../types";
import type { IgdbGame } from "./raw-types";

/**
 * IGDB fournit des URLs de couverture SANS le protocole (ex.
 * `//images.igdb.com/...`, convention documentée) — jamais transmis tel
 * quel à un composant `<Image>` qui exige une URL absolue.
 */
function absoluteImageUrl(url: string | undefined): string | null {
  if (!url) return null;
  return url.startsWith("//") ? `https:${url}` : url;
}

/**
 * `IgdbGame` → `CatalogItem` — ENRICHISSEMENT D'IDENTITÉ CATALOGUE JEUX
 * VIDÉO UNIQUEMENT (LOT "Free/Open Sources + Real Readiness + Live Smoke
 * Tests", section 7) : AUCUN prix — IGDB n'en fournit aucun, `priceHints`
 * jamais peuplé ici.
 */
export function normalizeIgdbGame(raw: IgdbGame, categorySlug: string): CatalogItem {
  return {
    source: "igdb",
    externalId: String(raw.id),
    kind: "video_game",
    categorySlug,
    name: raw.name ?? String(raw.id),
    canonicalAttributes: {
      slug: raw.slug ?? null,
      // `null` en épochs Unix SECONDES converti en ISO — jamais un nombre
      // brut exposé au reste du projet (qui attend des chaînes ISO
      // partout ailleurs, ex. `MarketObservation.observedAt`).
      firstReleaseDate: raw.first_release_date ? new Date(raw.first_release_date * 1000).toISOString() : null,
      platforms: raw.platforms && raw.platforms.length > 0 ? raw.platforms.map((p) => p.name).filter((n): n is string => Boolean(n)).join(",") : null,
    },
    images: absoluteImageUrl(raw.cover?.url) ? [absoluteImageUrl(raw.cover?.url)!] : [],
    externalUrl: raw.slug ? `https://www.igdb.com/games/${raw.slug}` : null,
    raw,
  };
}

/** Correspondance EXACTE sur le titre transmis à la requête `where name = "..."` — IGDB a déjà fait le filtrage exact côté serveur (jamais une similarité approximative devinée côté client). */
export function matchIgdbGame(raw: IgdbGame, categorySlug: string): CatalogMatch {
  return { item: normalizeIgdbGame(raw, categorySlug), confidence: 1, matchedOn: ["title"] };
}
