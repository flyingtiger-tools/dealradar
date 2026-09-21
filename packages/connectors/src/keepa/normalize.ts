import type { MarketObservation } from "../market-intelligence/market-observation";
import { MARKET_OBSERVATION_INGESTION_VERSION } from "../market-intelligence/market-observation";
import type { KeepaProduct } from "./raw-types";
import { KeepaCsvType, KEEPA_EPOCH_MS, KEEPA_NO_DATA_SENTINEL } from "./raw-types";

/**
 * Domaine Keepa (`domainId`) -> pays/devise. Liste FERMÉE (mêmes marchés
 * qu'Amazon opère réellement) — un domaine absent retourne `null`, jamais
 * une devise devinée (même discipline que `google-shopping/normalize.ts`).
 */
const DOMAIN_TO_MARKET: Record<number, { country: string; currency: string }> = {
  1: { country: "US", currency: "USD" },
  2: { country: "GB", currency: "GBP" },
  3: { country: "DE", currency: "EUR" },
  4: { country: "FR", currency: "EUR" },
  5: { country: "JP", currency: "JPY" },
  6: { country: "CA", currency: "CAD" },
  8: { country: "IT", currency: "EUR" },
  9: { country: "ES", currency: "EUR" },
  10: { country: "IN", currency: "INR" },
  11: { country: "MX", currency: "MXN" },
  12: { country: "BR", currency: "BRL" },
};

export function marketForKeepaDomain(domainId: number): { country: string; currency: string } | null {
  return DOMAIN_TO_MARKET[domainId] ?? null;
}

/**
 * Séries csv retenues (LOT "Source Wave 2") — un sous-ensemble volontaire de
 * l'énumération complète `KeepaCsvType` : uniquement celles qui portent un
 * PRIX exploitable par variante d'état distincte. `SALES`/`LISTPRICE`/
 * `LIGHTNING_DEAL`/les compteurs `COUNT_*` sont exclus (pas un prix de
 * marché directement comparable, voir l'énumération pour le détail de
 * chacun).
 *
 * Décision de palier documentée (jamais devinée) : AMAZON/NEW sont le prix
 * NEUF affiché/tracké dans le temps par Keepa -> **Tier E** ("retail neuf"),
 * quel que soit le moment observé — ce n'est jamais une vente confirmée, ni
 * une donnée calculée par un spécialiste, juste un prix affiché historisé.
 * USED/COLLECTIBLE/REFURBISHED/WAREHOUSE/NEW_FBA sont le suivi spécialisé
 * par Keepa de marchés secondaires distincts -> **Tier B** ("marché
 * spécialisé, donnée calculée/trackée dans le temps"). Keepa n'expose AUCUN
 * horodatage de transaction individuelle confirmée dans ce endpoint — donc
 * **jamais Tier A**, quelle que soit la série.
 */
const CSV_SERIES_CONFIG: readonly {
  type: KeepaCsvType;
  label: string;
  evidenceType: "retailPrices" | "historicalPrices";
  evidenceTier: "B" | "E";
  condition: string | null;
  completeness: string | null;
}[] = [
  { type: KeepaCsvType.AMAZON, label: "AMAZON", evidenceType: "retailPrices", evidenceTier: "E", condition: "new", completeness: null },
  { type: KeepaCsvType.NEW, label: "NEW", evidenceType: "retailPrices", evidenceTier: "E", condition: "new", completeness: null },
  { type: KeepaCsvType.NEW_FBA, label: "NEW_FBA", evidenceType: "historicalPrices", evidenceTier: "B", condition: "new", completeness: "fba" },
  { type: KeepaCsvType.USED, label: "USED", evidenceType: "historicalPrices", evidenceTier: "B", condition: "used", completeness: null },
  { type: KeepaCsvType.WAREHOUSE, label: "WAREHOUSE", evidenceType: "historicalPrices", evidenceTier: "B", condition: "used", completeness: "warehouse_deal" },
  { type: KeepaCsvType.COLLECTIBLE, label: "COLLECTIBLE", evidenceType: "historicalPrices", evidenceTier: "B", condition: "collectible", completeness: null },
  { type: KeepaCsvType.REFURBISHED, label: "REFURBISHED", evidenceType: "historicalPrices", evidenceTier: "B", condition: "refurbished", completeness: null },
];

export interface KeepaHistoryPoint {
  observedAt: string;
  priceCents: number;
}

/** `keepaTime` (minutes depuis 2011-01-01T00:00:00Z) -> ISO 8601. */
export function keepaTimeToIso(keepaTimeMinutes: number): string {
  return new Date(KEEPA_EPOCH_MS + keepaTimeMinutes * 60_000).toISOString();
}

/** `[time,value,time,value,...]` -> points, en écartant la valeur-sentinelle "aucune offre" (jamais un prix de 0/négatif fabriqué). */
export function parseKeepaCsvSeries(series: number[] | null | undefined): KeepaHistoryPoint[] {
  if (!series) return [];
  const points: KeepaHistoryPoint[] = [];
  for (let i = 0; i + 1 < series.length; i += 2) {
    const time = series[i]!;
    const value = series[i + 1]!;
    if (value === KEEPA_NO_DATA_SENTINEL) continue;
    points.push({ observedAt: keepaTimeToIso(time), priceCents: value });
  }
  return points;
}

export interface DownsampleOptions {
  /** Fraction de variation de prix (0-1) déclenchant la conservation d'un point — 0.05 par défaut (5%). */
  changeThresholdRatio?: number;
  /** Taille de fenêtre temporelle (jours) au-delà de laquelle un point est conservé même sans changement de prix notable — 30 par défaut. */
  bucketDays?: number;
}

const DEFAULT_CHANGE_THRESHOLD_RATIO = 0.05;
const DEFAULT_BUCKET_DAYS = 30;

/**
 * Réduction d'un historique Keepa potentiellement très long (LOT "Source
 * Wave 2", exigence explicite : "ne pas noyer la base") — stratégie
 * documentée : conserve TOUJOURS le premier et le dernier point, puis tout
 * point dont le prix change d'au moins `changeThresholdRatio` par rapport
 * au dernier point CONSERVÉ (un "point de changement"), et au minimum un
 * point par fenêtre de `bucketDays` jours même sans changement notable
 * (pour ne jamais avoir un trou de plusieurs mois sans aucune donnée).
 * Chaque point conservé garde son horodatage D'ORIGINE tel qu'observé par
 * Keepa — jamais un horodatage de fenêtre/bucket fabriqué.
 */
export function downsampleKeepaHistory(points: readonly KeepaHistoryPoint[], options: DownsampleOptions = {}): KeepaHistoryPoint[] {
  if (points.length === 0) return [];
  const changeThreshold = options.changeThresholdRatio ?? DEFAULT_CHANGE_THRESHOLD_RATIO;
  const bucketMs = (options.bucketDays ?? DEFAULT_BUCKET_DAYS) * 24 * 60 * 60 * 1000;

  const sorted = [...points].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const kept: KeepaHistoryPoint[] = [sorted[0]!];
  let lastKeptMs = Date.parse(sorted[0]!.observedAt);

  for (let i = 1; i < sorted.length; i += 1) {
    const point = sorted[i]!;
    const prevKept = kept[kept.length - 1]!;
    const isLast = i === sorted.length - 1;
    const priceChangedEnough = Math.abs(point.priceCents - prevKept.priceCents) / Math.max(1, prevKept.priceCents) >= changeThreshold;
    const pointMs = Date.parse(point.observedAt);
    const bucketElapsed = pointMs - lastKeptMs >= bucketMs;

    if (priceChangedEnough || bucketElapsed || isLast) {
      kept.push(point);
      lastKeptMs = pointMs;
    }
  }

  return kept;
}

export interface NormalizeKeepaContext {
  query: string;
  domainId: number;
  collectedAt: string;
  downsample?: DownsampleOptions;
}

/**
 * Un produit Keepa -> N `MarketObservation` (une par point retenu après
 * downsampling, par série csv retenue) — jamais une seule moyenne qui
 * masquerait des états de marché très différents (neuf/occasion/gradé) ou
 * une évolution dans le temps. Domaine non reconnu ou aucune série
 * exploitable -> tableau vide, jamais un prix deviné.
 */
export function normalizeKeepaProduct(product: KeepaProduct, context: NormalizeKeepaContext): MarketObservation[] {
  const market = marketForKeepaDomain(context.domainId);
  if (!market || !product.csv) return [];

  const title = product.title ?? product.asin;
  const identifiers: Record<string, string> = { asin: product.asin };
  if (product.eanList?.[0]) identifiers.ean = product.eanList[0];
  if (product.upcList?.[0]) identifiers.upc = product.upcList[0];

  const observations: MarketObservation[] = [];

  for (const seriesConfig of CSV_SERIES_CONFIG) {
    const rawSeries = product.csv[seriesConfig.type];
    const points = downsampleKeepaHistory(parseKeepaCsvSeries(rawSeries), context.downsample);

    for (const point of points) {
      observations.push({
        source: "keepa",
        sourceItemId: `${product.asin}:${seriesConfig.label}`,
        sourceUrl: `https://www.amazon.com/dp/${product.asin}`,
        observedAt: point.observedAt,
        productKey: null,
        query: context.query,
        title,
        brand: null,
        model: null,
        variant: null,
        identifiers,
        condition: seriesConfig.condition,
        completeness: seriesConfig.completeness,
        priceAmountCents: point.priceCents,
        currency: market.currency,
        shippingCostCents: null,
        totalPriceCents: null,
        country: market.country,
        marketplace: "amazon",
        evidenceType: seriesConfig.evidenceType,
        evidenceTier: seriesConfig.evidenceTier,
        // Keepa ne représente jamais une vente individuelle confirmée sur cet endpoint — voir l'en-tête du fichier.
        soldAt: null,
        matchScore: 1,
        rawMetadataRef: { csvSeries: seriesConfig.label, domainId: context.domainId },
        ingestionVersion: MARKET_OBSERVATION_INGESTION_VERSION,
      });
    }
  }

  return observations;
}
