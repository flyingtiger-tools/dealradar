import type { SourceCostClass } from "./source-routing";

/**
 * Matrice de préparation live (LOT "Historical Data Engine + Product
 * Identity Enrichment + Live-Readiness", section 13) — descripteur
 * DÉCLARATIF et lisible par machine de l'état de CHAQUE source connue,
 * qu'elle soit implémentée ou seulement candidate. Objectif explicite du
 * lot : activer une credential plus tard devient une étape de
 * CONFIGURATION, jamais une réécriture d'architecture — ce fichier est LE
 * point de vérité unique que `buildMarketSourcesFromEnv` (`apps/workers`)
 * et les diagnostics consomment, jamais une supposition dispersée dans le
 * code.
 *
 * Jamais confondu : "implémenté" (le connecteur existe et est testé avec
 * des fixtures) et "live tested" (un appel réseau réel a été effectué).
 * Ce fichier ne lit JAMAIS `process.env` lui-même — `resolveSourceReadiness`
 * prend la présence de variables déjà observée par l'appelant (voir
 * `apps/workers/src/ingestion/market-source-factory.ts`), pure et testable.
 */

export type ActivationStatus = "ready" | "missing_credentials" | "restricted" | "disabled_policy" | "license_required";

export interface SourceReadinessDescriptor {
  source: string;
  requiredEnvVars: readonly string[];
  optionalEnvVars: readonly string[];
  categoryCoverage: readonly string[] | "any";
  capabilities: readonly string[];
  /** `true` UNIQUEMENT si un appel réseau réel a été effectué et vérifié au cours d'un lot précédent — jamais déduit de "implémenté". */
  liveTested: boolean;
  /** Statut STATIQUE de politique produit — `"restricted"`/`"disabled_policy"`/`"license_required"` sont des verrous qui ne dépendent JAMAIS de la présence de credentials (voir `resolveSourceReadiness`, qui les fait toujours primer). */
  policyStatus: ActivationStatus;
  costClass: SourceCostClass;
  /** `false` = ne jamais activer même si toutes les credentials sont présentes (ex. accès non autorisé, licence non négociée). */
  productionAllowed: boolean;
  notes: string;
}

export const SOURCE_READINESS_MATRIX: readonly SourceReadinessDescriptor[] = [
  {
    source: "ebay",
    requiredEnvVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_MARKETPLACE_ID", "EBAY_ENVIRONMENT"],
    optionalEnvVars: [],
    categoryCoverage: "any",
    capabilities: ["activeListings"],
    liveTested: false,
    policyStatus: "missing_credentials",
    costClass: "free",
    productionAllowed: true,
    notes: "API Browse officielle OAuth, déjà en Production côté ingestion TCG pré-existante. Adapté en MarketSource (Source Wave 1). Noms de credential présents en local/Railway, valeurs jamais vérifiées fonctionnelles.",
  },
  {
    source: "google_shopping",
    requiredEnvVars: ["SERPAPI_KEY"],
    optionalEnvVars: [],
    categoryCoverage: "any",
    capabilities: ["retailPrices", "activeListings", "search"],
    liveTested: false,
    policyStatus: "missing_credentials",
    costClass: "paid",
    productionAllowed: true,
    notes: "SerpApi — Source Wave 1. Implémenté et câblé, jamais interrogé en direct.",
  },
  {
    source: "dataforseo_google_shopping",
    requiredEnvVars: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    optionalEnvVars: ["DATAFORSEO_LOCATION_CODE"],
    categoryCoverage: "any",
    capabilities: ["retailPrices", "search"],
    liveTested: false,
    policyStatus: "missing_credentials",
    costClass: "paid",
    productionAllowed: true,
    notes: "Second fournisseur Google Shopping (Source Wave 3) — API asynchrone (task_post/task_get), sondage borné. Implémenté et câblé, jamais interrogé en direct.",
  },
  {
    source: "bricklink",
    requiredEnvVars: ["BRICKLINK_CONSUMER_KEY", "BRICKLINK_CONSUMER_SECRET", "BRICKLINK_TOKEN_VALUE", "BRICKLINK_TOKEN_SECRET"],
    optionalEnvVars: [],
    categoryCoverage: ["lego"],
    capabilities: ["historicalPrices", "activeListings"],
    liveTested: false,
    policyStatus: "missing_credentials",
    costClass: "free",
    productionAllowed: true,
    notes: "OAuth 1.0a signé à la main (Source Wave 1), signeur vérifié par test croisé non-tautologique. Palier 'sold' = B, jamais A (agrégat, pas une vente individuelle confirmée).",
  },
  {
    source: "pricecharting",
    requiredEnvVars: ["PRICECHARTING_TOKEN"],
    optionalEnvVars: [],
    categoryCoverage: ["gaming", "collectibles"],
    capabilities: ["historicalPrices"],
    liveTested: false,
    policyStatus: "license_required",
    costClass: "cheap",
    productionAllowed: false,
    notes: "Contrat typé implémenté et câblé (Source Wave 1/2), mais conditions de licence commerciale pour un usage serveur applicatif JAMAIS vérifiées — ne pas activer en Production sans clarification explicite, même une fois la credential posée.",
  },
  {
    source: "keepa",
    requiredEnvVars: ["KEEPA_API_KEY"],
    optionalEnvVars: [],
    categoryCoverage: ["gaming", "apple", "pc_components"],
    capabilities: ["retailPrices", "historicalPrices", "barcodeLookup"],
    liveTested: false,
    policyStatus: "missing_credentials",
    costClass: "paid",
    productionAllowed: true,
    notes: "Source Wave 2. Downsampling d'historique documenté. Jamais Tier A (aucune vente individuelle confirmée sur cet endpoint).",
  },
  {
    source: "zyte",
    requiredEnvVars: ["ZYTE_API_KEY"],
    optionalEnvVars: [],
    categoryCoverage: "any",
    capabilities: [],
    liveTested: false,
    policyStatus: "missing_credentials",
    costClass: "high_cost",
    productionAllowed: true,
    notes: "Fournisseur de scraping GÉNÉRIQUE (Source Wave 2), pas une source de marché en soi — implémenté et testé, aucune logique anti-bot dans DealRadar (gérée côté vendeur).",
  },
  {
    source: "ricardo",
    requiredEnvVars: [],
    optionalEnvVars: [],
    categoryCoverage: "any",
    capabilities: ["activeListings"],
    liveTested: false,
    policyStatus: "restricted",
    costClass: "high_cost",
    productionAllowed: false,
    notes: "Contrat + fixtures implémentés (Source Wave 2) via Zyte, mais activation Production NON recommandée : Cloudflare + robots.txt excluant explicitement les recherches paramétrées (voir docs/market-intelligence-sources.md). Nécessite ZYTE_API_KEY pour même être construit, mais reste `productionAllowed: false` indépendamment de ça — un verrou de politique, jamais une simple absence de credential.",
  },
  {
    source: "tutti",
    requiredEnvVars: [],
    optionalEnvVars: [],
    categoryCoverage: "any",
    capabilities: [],
    liveTested: false,
    policyStatus: "disabled_policy",
    costClass: "high_cost",
    productionAllowed: false,
    notes: "Mur CAPTCHA immédiat vérifié (Source Wave 2) — aucune implémentation possible sans contourner une protection anti-bot, interdit par une règle absolue de ce projet.",
  },
  {
    source: "anibis",
    requiredEnvVars: [],
    optionalEnvVars: [],
    categoryCoverage: "any",
    capabilities: [],
    liveTested: false,
    policyStatus: "disabled_policy",
    costClass: "high_cost",
    productionAllowed: false,
    notes: "Mur CAPTCHA immédiat vérifié (Source Wave 2) — même raison que Tutti.",
  },
  {
    source: "tcgplayer",
    requiredEnvVars: ["TCGPLAYER_PUBLIC_KEY", "TCGPLAYER_PRIVATE_KEY"],
    optionalEnvVars: [],
    categoryCoverage: ["pokemon_tcg"],
    capabilities: [],
    liveTested: false,
    policyStatus: "restricted",
    costClass: "free",
    productionAllowed: false,
    notes: "Candidatures développeur publiques closes depuis le rachat par eBay (constat factuel, Source Wave 3) — accès réservé aux détenteurs de clés existants/partenaires. Aucun code écrit (aucune structure de réponse vérifiable). JustTCG/TCGdex couvrent déjà le pricing TCG pour ce MVP.",
  },
  {
    source: "stockx",
    requiredEnvVars: [],
    optionalEnvVars: [],
    categoryCoverage: ["sneakers"],
    capabilities: [],
    liveTested: false,
    policyStatus: "restricted",
    costClass: "free",
    productionAllowed: false,
    notes: "API positionnée comme outillage VENDEUR (constat factuel, Source Wave 3), pas un accès de recherche ouvert à des tiers. DealRadar n'est pas vendeur StockX. Aucun code écrit.",
  },
  {
    source: "watchcharts",
    requiredEnvVars: ["WATCHCHARTS_API_KEY"],
    optionalEnvVars: [],
    categoryCoverage: ["watches"],
    capabilities: [],
    liveTested: false,
    policyStatus: "license_required",
    costClass: "paid",
    productionAllowed: false,
    notes: "Abonnement payant Professional+API requis pour une clé, PLUS une licence de Distribution/Revente séparée et négociée requise pour afficher les données à des utilisateurs tiers (constat factuel, Source Wave 3). Documentation technique inaccessible (Cloudflare) — aucun code écrit, structure de réponse jamais vérifiée.",
  },
  {
    source: "frankfurter",
    requiredEnvVars: [],
    optionalEnvVars: [],
    categoryCoverage: "any",
    capabilities: ["fx"],
    liveTested: false,
    policyStatus: "missing_credentials", // techniquement "ready" (aucune credential requise) mais jamais vérifié en appel réel ce lot — voir `resolveSourceReadiness`, un `requiredEnvVars` vide résout automatiquement à "ready" quel que soit ce statut statique.
    costClass: "free",
    productionAllowed: true,
    notes: "Fournisseur FX gratuit, sans authentification (pré-existant), câblé avec cache TTL (Source Wave 3) dans le chemin d'analyse générique. Aucune credential requise — toujours 'ready' en pratique, jamais bloqué par ce lot.",
  },
] as const;

/**
 * Statut d'activation RÉEL — combine le descripteur statique avec la
 * présence de variables d'environnement OBSERVÉE par l'appelant (jamais
 * lue depuis `process.env` ici, voir l'en-tête du fichier). Un verrou de
 * politique (`restricted`/`disabled_policy`/`license_required`) prime
 * TOUJOURS sur la présence de credentials — poser une clé API pour
 * TCGplayer/StockX/WatchCharts/Ricardo/Tutti/Anibis ne les rend jamais
 * "ready" tant que le verrou de politique n'est pas explicitement levé
 * dans CE fichier par un futur lot.
 */
export function resolveSourceReadiness(descriptor: SourceReadinessDescriptor, envPresence: Readonly<Record<string, boolean>>): ActivationStatus {
  if (descriptor.policyStatus !== "missing_credentials") return descriptor.policyStatus;
  const allRequiredPresent = descriptor.requiredEnvVars.every((name) => envPresence[name] === true);
  return allRequiredPresent ? "ready" : "missing_credentials";
}
