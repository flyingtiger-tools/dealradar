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
  lego: ["bricklink", "ebay", "google_shopping", "dataforseo_google_shopping", "ricardo", "tutti", "anibis"],
  gaming: ["pricecharting", "ebay", "google_shopping", "dataforseo_google_shopping", "keepa"],
  sneakers: ["stockx", "ebay", "google_shopping", "dataforseo_google_shopping"],
  pokemon_tcg: ["tcgplayer", "justtcg", "tcgdex", "google_shopping", "dataforseo_google_shopping"],
  apple: ["google_shopping", "dataforseo_google_shopping", "ebay", "keepa", "ricardo", "tutti", "anibis"],
  photo: ["ebay", "google_shopping", "dataforseo_google_shopping", "ricardo", "tutti"],
  watches: ["watchcharts", "ebay", "google_shopping", "dataforseo_google_shopping"],
  pc_components: ["google_shopping", "dataforseo_google_shopping", "ebay", "keepa"],
  collectibles: ["ebay", "google_shopping", "dataforseo_google_shopping"],
  /** Aucune source spécialisée n'a de sens pour "general" — sources larges uniquement, jamais une supposition de spécialité. */
  general: ["google_shopping", "dataforseo_google_shopping", "ebay"],
};

const DEFAULT_PREFERENCES: readonly string[] = CATEGORY_SOURCE_PREFERENCES.general!;

/** Préférences déclarées pour `categorySlug`, ou le repli générique `general` si la catégorie n'a pas d'entrée dédiée — jamais un tableau vide silencieux qui masquerait une catégorie oubliée. */
export function preferredSourceNamesForCategory(categorySlug: string): readonly string[] {
  return CATEGORY_SOURCE_PREFERENCES[categorySlug] ?? DEFAULT_PREFERENCES;
}

/**
 * Classe de coût DÉCLARATIVE par source (LOT "Source Wave 3", section 6) —
 * PAS un système de facturation (aucun montant réel, aucun suivi de
 * consommation ici) : juste une donnée qui permet à un appelant de
 * plafonner le coût d'une résolution de sources (`maxCostClass`,
 * `ResolveSourcesOptions`) sans construire une logique de billing. Ordre
 * `free < cheap < paid < high_cost`. Une source ABSENTE de cette table est
 * traitée comme `"paid"` par défaut (jamais supposée gratuite sans le
 * déclarer explicitement — voir `costClassForSource`).
 */
export type SourceCostClass = "free" | "cheap" | "paid" | "high_cost";

const COST_CLASS_ORDER: Record<SourceCostClass, number> = { free: 0, cheap: 1, paid: 2, high_cost: 3 };

export const SOURCE_COST_CLASS: Record<string, SourceCostClass> = {
  ebay: "free",
  bricklink: "free",
  tcgdex: "free",
  justtcg: "free",
  tcgplayer: "free",
  stockx: "free",
  pricecharting: "cheap",
  google_shopping: "paid",
  dataforseo_google_shopping: "paid",
  keepa: "paid",
  watchcharts: "paid",
  // Zyte facture par requête ET Ricardo n'est pas recommandé pour une activation Production (voir docs/market-intelligence-sources.md) — classé le plus cher pour qu'un plafond `maxCostClass` raisonnable l'exclue par défaut.
  ricardo: "high_cost",
};

/** `SOURCE_COST_CLASS[sourceName]`, ou `"paid"` par défaut — jamais `"free"` pour une source non déclarée. */
export function costClassForSource(sourceName: string): SourceCostClass {
  return SOURCE_COST_CLASS[sourceName] ?? "paid";
}

function isWithinCostClass(sourceName: string, maxCostClass: SourceCostClass): boolean {
  return COST_CLASS_ORDER[costClassForSource(sourceName)] <= COST_CLASS_ORDER[maxCostClass];
}

export interface ResolveSourcesOptions {
  /** État de santé connu par source (voir `source-health-tracker.ts`) — une source sans état connu est considérée saine (jamais exclue sans preuve d'échec). */
  health?: Record<string, SourceHealthState>;
  /**
   * Plafond de COMPTE de sources retournées (jamais un budget en argent —
   * "budget-ready hook", pas un système de facturation) — appliqué APRÈS
   * l'ordre de préférence/coût, donc tronque toujours les sources les
   * MOINS prioritaires en premier. `undefined` = aucune limite.
   */
  maxSourceCount?: number;
  /** Classe de coût maximale acceptée (voir `SourceCostClass`) — une source plus chère que ce plafond est exclue. `undefined` = aucune restriction. */
  maxCostClass?: SourceCostClass;
}

/**
 * Liste ORDONNÉE des sources candidates pour une catégorie, AVANT tout
 * plafond de budget : préférence déclarée (donnée) ∩ sources enregistrées
 * ∩ supportant la catégorie ∩ en bonne santé. Extrait de
 * `resolveSourcesForCategory` (LOT "Real DB Integration + Exact Budget
 * Enforcement...", section 3) pour être réutilisé tel quel par
 * `buildSourceSelectionPlan` (`packages/ingestion`) — UNE SEULE définition
 * de l'ordre de préférence, jamais deux logiques d'ordonnancement
 * divergentes entre le chemin interactif et le chemin de rafraîchissement
 * (exigence explicite du lot : "no hidden differences between the two
 * paths unless explicitly documented").
 */
export function orderedCandidateSourcesForCategory(
  categorySlug: string,
  availableSources: readonly MarketSource[],
  health?: Record<string, SourceHealthState>,
): MarketSource[] {
  const preferredNames = preferredSourceNamesForCategory(categorySlug);
  const bySource = new Map(availableSources.map((s) => [s.source, s] as const));

  const resolved: MarketSource[] = [];
  for (const name of preferredNames) {
    const source = bySource.get(name);
    if (!source) continue;
    if (!marketSourceSupportsCategory(source, categorySlug)) continue;
    const sourceHealth = health?.[source.source];
    if (sourceHealth && !isSourceHealthy(sourceHealth)) continue;
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
    const sourceHealth = health?.[source.source];
    if (sourceHealth && !isSourceHealthy(sourceHealth)) continue;
    resolved.push(source);
  }

  return resolved;
}

/**
 * Résout la liste ORDONNÉE des sources réellement disponibles pour une
 * catégorie, PLAFONNÉE par coût/compte. Aucune source n'est jamais
 * obligatoire — une liste vide est un résultat valide (l'agrégateur
 * dégrade gracieusement, voir `aggregate-market-observations.ts`).
 *
 * NOTE (section 3 du lot) : ce plafonnage `maxCostClass`/`maxSourceCount`
 * reste une approximation APRÈS-COUP par rapport à `buildSourceSelectionPlan`
 * (`packages/ingestion`), qui applique désormais l'enforcement EXACT
 * (compte par classe de coût, PAR CIBLE et PAR RUN) avant toute requête.
 * Cette fonction reste utilisée par du code n'ayant pas encore migré vers
 * le plan de sélection explicite — jamais supprimée pour préserver la
 * compatibilité, mais plus la voie recommandée pour un nouvel appelant.
 */
export function resolveSourcesForCategory(
  categorySlug: string,
  availableSources: readonly MarketSource[],
  options: ResolveSourcesOptions = {},
): MarketSource[] {
  const resolved = orderedCandidateSourcesForCategory(categorySlug, availableSources, options.health);
  const withinBudget = options.maxCostClass ? resolved.filter((s) => isWithinCostClass(s.source, options.maxCostClass!)) : resolved;
  return options.maxSourceCount !== undefined ? withinBudget.slice(0, options.maxSourceCount) : withinBudget;
}
