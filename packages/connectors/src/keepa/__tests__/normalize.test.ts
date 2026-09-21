import { describe, expect, it } from "vitest";
import { downsampleKeepaHistory, keepaTimeToIso, marketForKeepaDomain, normalizeKeepaProduct, parseKeepaCsvSeries, type KeepaHistoryPoint } from "../normalize";
import { KeepaCsvType, KEEPA_EPOCH_MS } from "../raw-types";
import type { KeepaProduct } from "../raw-types";

const CONTEXT = { query: "nintendo switch oled", domainId: 1, collectedAt: "2026-09-21T00:00:00.000Z" };

function daysAfterEpochMinutes(days: number): number {
  return (days * 24 * 60 * 60 * 1000) / 60_000;
}

describe("keepaTimeToIso", () => {
  it("convertit correctement l'époque Keepa (2011-01-01T00:00:00Z + 0 minute)", () => {
    expect(keepaTimeToIso(0)).toBe(new Date(KEEPA_EPOCH_MS).toISOString());
  });

  it("convertit un décalage de minutes non nul", () => {
    expect(keepaTimeToIso(1440)).toBe(new Date(KEEPA_EPOCH_MS + 1440 * 60_000).toISOString());
  });
});

describe("parseKeepaCsvSeries", () => {
  it("écarte la valeur-sentinelle -1 (aucune offre), jamais un prix fabriqué", () => {
    const points = parseKeepaCsvSeries([100, 2999, 200, -1, 300, 3099]);
    expect(points).toEqual([
      { observedAt: keepaTimeToIso(100), priceCents: 2999 },
      { observedAt: keepaTimeToIso(300), priceCents: 3099 },
    ]);
  });

  it("série null ou absente -> tableau vide", () => {
    expect(parseKeepaCsvSeries(null)).toEqual([]);
    expect(parseKeepaCsvSeries(undefined)).toEqual([]);
  });
});

describe("downsampleKeepaHistory", () => {
  it("conserve toujours le premier et le dernier point", () => {
    const points: KeepaHistoryPoint[] = [
      { observedAt: keepaTimeToIso(0), priceCents: 1000 },
      { observedAt: keepaTimeToIso(daysAfterEpochMinutes(1)), priceCents: 1005 },
      { observedAt: keepaTimeToIso(daysAfterEpochMinutes(2)), priceCents: 1010 },
    ];
    const result = downsampleKeepaHistory(points, { changeThresholdRatio: 0.5, bucketDays: 3650 });
    expect(result[0]).toEqual(points[0]);
    expect(result[result.length - 1]).toEqual(points[2]);
  });

  it("conserve un point de changement notable (>= seuil), écarte les variations négligeables", () => {
    const points: KeepaHistoryPoint[] = [
      { observedAt: keepaTimeToIso(daysAfterEpochMinutes(0)), priceCents: 10000 },
      { observedAt: keepaTimeToIso(daysAfterEpochMinutes(1)), priceCents: 10010 }, // +0.1%, négligeable
      { observedAt: keepaTimeToIso(daysAfterEpochMinutes(2)), priceCents: 12000 }, // +20%, notable
      { observedAt: keepaTimeToIso(daysAfterEpochMinutes(3)), priceCents: 12005 }, // +0.04%, négligeable
    ];
    const result = downsampleKeepaHistory(points, { changeThresholdRatio: 0.05, bucketDays: 3650 });
    expect(result.map((p) => p.priceCents)).toEqual([10000, 12000, 12005]); // dernier point toujours conservé
  });

  it("conserve au moins un point par fenêtre temporelle même sans changement de prix", () => {
    const points: KeepaHistoryPoint[] = Array.from({ length: 5 }, (_, i) => ({
      observedAt: keepaTimeToIso(daysAfterEpochMinutes(i * 40)), // 40 jours d'écart, prix constant
      priceCents: 5000,
    }));
    const result = downsampleKeepaHistory(points, { changeThresholdRatio: 0.5, bucketDays: 30 });
    expect(result.length).toBeGreaterThan(2); // sans le bucket, seuls premier+dernier seraient conservés
  });

  it("chaque point conservé garde son horodatage D'ORIGINE, jamais un horodatage de bucket fabriqué", () => {
    const points: KeepaHistoryPoint[] = [
      { observedAt: keepaTimeToIso(daysAfterEpochMinutes(0)), priceCents: 1000 },
      { observedAt: keepaTimeToIso(daysAfterEpochMinutes(45)), priceCents: 1000 },
    ];
    const result = downsampleKeepaHistory(points, { bucketDays: 30 });
    expect(result.map((p) => p.observedAt)).toEqual(points.map((p) => p.observedAt));
  });

  it("liste vide -> liste vide", () => {
    expect(downsampleKeepaHistory([])).toEqual([]);
  });
});

describe("marketForKeepaDomain", () => {
  it("domaine connu -> pays/devise", () => {
    expect(marketForKeepaDomain(1)).toEqual({ country: "US", currency: "USD" });
    expect(marketForKeepaDomain(3)).toEqual({ country: "DE", currency: "EUR" });
  });

  it("domaine inconnu -> null, jamais une devise devinée", () => {
    expect(marketForKeepaDomain(999)).toBeNull();
  });
});

function rawProduct(overrides: Partial<KeepaProduct> = {}): KeepaProduct {
  return {
    asin: "B00005N5PF",
    title: "Nintendo Switch OLED",
    domainId: 1,
    csv: [],
    ...overrides,
  };
}

describe("normalizeKeepaProduct", () => {
  it("AMAZON/NEW -> retailPrices, Tier E, condition 'new'", () => {
    const csv: number[][] = [];
    csv[KeepaCsvType.AMAZON] = [0, 34999];
    const observations = normalizeKeepaProduct(rawProduct({ csv }), CONTEXT);
    expect(observations).toHaveLength(1);
    expect(observations[0]!.evidenceType).toBe("retailPrices");
    expect(observations[0]!.evidenceTier).toBe("E");
    expect(observations[0]!.condition).toBe("new");
  });

  it("USED/COLLECTIBLE/REFURBISHED/WAREHOUSE -> historicalPrices, Tier B, jamais fusionnés entre eux", () => {
    const csv: number[][] = [];
    csv[KeepaCsvType.USED] = [0, 19999];
    csv[KeepaCsvType.COLLECTIBLE] = [0, 45000];
    csv[KeepaCsvType.REFURBISHED] = [0, 22000];
    csv[KeepaCsvType.WAREHOUSE] = [0, 21000];
    const observations = normalizeKeepaProduct(rawProduct({ csv }), CONTEXT);
    expect(observations).toHaveLength(4);
    expect(observations.every((o) => o.evidenceType === "historicalPrices" && o.evidenceTier === "B")).toBe(true);
    const byCondition = new Map(observations.map((o) => [`${o.condition}:${o.completeness}`, o.priceAmountCents]));
    expect(byCondition.get("used:null")).toBe(19999);
    expect(byCondition.get("collectible:null")).toBe(45000);
    expect(byCondition.get("refurbished:null")).toBe(22000);
    expect(byCondition.get("used:warehouse_deal")).toBe(21000);
  });

  it("jamais Tier A, jamais soldTransactions, jamais soldAt renseigné — Keepa n'expose aucune vente confirmée", () => {
    const csv: number[][] = [];
    csv[KeepaCsvType.AMAZON] = [0, 1000];
    csv[KeepaCsvType.USED] = [0, 900];
    const observations = normalizeKeepaProduct(rawProduct({ csv }), CONTEXT);
    expect(observations.every((o) => o.evidenceTier !== "A")).toBe(true);
    expect(observations.every((o) => o.evidenceType !== "soldTransactions")).toBe(true);
    expect(observations.every((o) => o.soldAt === null)).toBe(true);
  });

  it("préserve ASIN et EAN/UPC connus dans identifiers", () => {
    const csv: number[][] = [];
    csv[KeepaCsvType.AMAZON] = [0, 1000];
    const observations = normalizeKeepaProduct(rawProduct({ csv, eanList: ["0045496883254"], upcList: ["045496883254"] }), CONTEXT);
    expect(observations[0]!.identifiers).toEqual({ asin: "B00005N5PF", ean: "0045496883254", upc: "045496883254" });
  });

  it("domaine non reconnu -> tableau vide, jamais une devise devinée", () => {
    const csv: number[][] = [];
    csv[KeepaCsvType.AMAZON] = [0, 1000];
    const observations = normalizeKeepaProduct(rawProduct({ csv }), { ...CONTEXT, domainId: 999 });
    expect(observations).toEqual([]);
  });

  it("aucune série csv exploitable -> tableau vide", () => {
    expect(normalizeKeepaProduct(rawProduct({ csv: undefined }), CONTEXT)).toEqual([]);
  });

  it("un historique de plusieurs points par série produit plusieurs observations distinctes (une par point retenu)", () => {
    const csv: number[][] = [];
    csv[KeepaCsvType.AMAZON] = [
      daysAfterEpochMinutes(0), 30000,
      daysAfterEpochMinutes(1), 30500,
      daysAfterEpochMinutes(60), 25000,
    ];
    const observations = normalizeKeepaProduct(rawProduct({ csv }), CONTEXT);
    expect(observations.length).toBeGreaterThanOrEqual(2);
    expect(new Set(observations.map((o) => o.observedAt)).size).toBe(observations.length); // horodatages distincts, jamais dédupliqués à tort
  });
});
