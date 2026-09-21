import type { MarketSource } from "./market-source";
import { marketSourceSupportsCategory } from "./market-source";
import { isSourceHealthy, type SourceHealthState } from "./source-health-tracker";

/**
 * Table déclarative catégorie -> sources préférées (LOT "Multi-Source
 * Market Intelligence Foundation") — DONNÉE, jamais une chaîne de
 * `if/else`/`switch` par catégorie éparpillée dans le code métier. L'ordre
 * dans chaque tableau EST la préférence (première = préférée), jamais une
 * garantie de disponibilité — `resolveSourcesForCategory` filtre ensuite
 * par ce qui est réellement enregistré/en bonne santé.
 *
 * Les slugs ici sont des noms de source LOGIQUES (voir `MarketSource.source`)
 * — cette table ne dépend d'aucune implémentation concrète et reste valide
 * même si une source listée n'est pas encore construite (voir
 * `docs/market-intelligence-sources.md` pour l'état d'implémentation réel
 * de chacune).
 */
export const CATEGORY_SOURCE_PREFERENCES: Record<string, readonly string[]> = {
  lego: ["bricklink", "ebay", "google_shopping", "ricardo", "tutti", "anibis"],
  gaming: ["pricecharting", "ebay", "google_shopping", "keepa"],
  sneakers: ["stockx", "ebay", "google_shopping"],
  pokemon_tcg: ["tcgplayer", "justtcg", "tcgdex", "google_shopping"],
  apple: ["google_shopping", "ebay", "keepa", "ricardo", "tutti", "anibis"],
  photo: ["ebay", "google_shopping", "ricardo", "tutti"],
  watches: ["watchcharts", "ebay", "google_shopping"],
  pc_components: ["google_shopping", "ebay", "keepa"],
  collectibles: ["ebay", "google_shopping"],
  /** Aucune source spécialisée n'a de sens pour "general" — sources larges uniquement, jamais une supposition de spécialité. */
  general: ["google_shopping", "ebay"],
};

const DEFAULT_PREFERENCES: readonly string[] = CATEGORY_SOURCE_PREFERENCES.general!;

/** Préférences déclarées pour `categorySlug`, ou le repli générique `general` si la catégorie n'a pas d'entrée dédiée — jamais un tableau vide silencieux qui masquerait une catégorie oubliée. */
export function preferredSourceNamesForCategory(categorySlug: string): readonly string[] {
  return CATEGORY_SOURCE_PREFERENCES[categorySlug] ?? DEFAULT_PREFERENCES;
}

export interface ResolveSourcesOptions {
  /** État de santé connu par source (voir `source-health-tracker.ts`) — une source sans état connu est considérée saine (jamais exclue sans preuve d'échec). */
  health?: Record<string, SourceHealthState>;
}

/**
 * Résout la liste ORDONNÉE des sources réellement disponibles pour une
 * catégorie : préférence déclarée (donnée) ∩ sources enregistrées ∩
 * supportant la catégorie ∩ en bonne santé. Aucune source n'est jamais
 * obligatoire — une liste vide est un résultat valide (l'agrégateur
 * dégrade gracieusement, voir `aggregate-market-observations.ts`).
 */
export function resolveSourcesForCategory(
  categorySlug: string,
  availableSources: readonly MarketSource[],
  options: ResolveSourcesOptions = {},
): MarketSource[] {
  const preferredNames = preferredSourceNamesForCategory(categorySlug);
  const bySource = new Map(availableSources.map((s) => [s.source, s] as const));

  const resolved: MarketSource[] = [];
  for (const name of preferredNames) {
    const source = bySource.get(name);
    if (!source) continue;
    if (!marketSourceSupportsCategory(source, categorySlug)) continue;
    const health = options.health?.[source.source];
    if (health && !isSourceHealthy(health)) continue;
    resolved.push(source);
  }

  // Une source enregistrée et pertinente mais absente de la table de
  // préférence (ex. catégorie non couverte explicitement) reste
  // utilisable si elle déclare supporter la catégorie — jamais ignorée
  // silencieusement au seul motif qu'elle n'est pas dans la liste
  // préférée.
  for (const source of availableSources) {
    if (resolved.includes(source)) continue;
    if (!marketSourceSupportsCategory(source, categorySlug)) continue;
    const health = options.health?.[source.source];
    if (health && !isSourceHealthy(health)) continue;
    resolved.push(source);
  }

  return resolved;
}
