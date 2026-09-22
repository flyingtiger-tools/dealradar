import { describe, expect, it } from "vitest";
import { normalizeOpenPricesItem } from "../normalize";
import { ELEFAN_PRICE_OBSERVATIONS } from "./fixtures/responses";

describe("normalizeOpenPricesItem", () => {
  const item = ELEFAN_PRICE_OBSERVATIONS.items[0]!;

  it("evidenceType TOUJOURS 'retailPrices', evidenceTier TOUJOURS 'E', soldAt TOUJOURS null — jamais confondu avec une vente confirmée", () => {
    const obs = normalizeOpenPricesItem(item, { categorySlug: "general", query: "1541513213246", collectedAt: "2026-09-22T00:00:00.000Z" });
    expect(obs.evidenceType).toBe("retailPrices");
    expect(obs.evidenceTier).toBe("E");
    expect(obs.soldAt).toBeNull();
  });

  it("prix converti en centimes, devise transmise telle quelle", () => {
    const obs = normalizeOpenPricesItem(item, { categorySlug: "general", query: "x", collectedAt: "2026-09-22T00:00:00.000Z" });
    expect(obs.priceAmountCents).toBe(2770);
    expect(obs.currency).toBe("EUR");
  });

  it("observedAt = date d'observation réelle, jamais la date d'enregistrement système quand les deux diffèrent", () => {
    const obs = normalizeOpenPricesItem(item, { categorySlug: "general", query: "x", collectedAt: "2026-09-22T00:00:00.000Z" });
    expect(obs.observedAt).toBe("2023-11-27");
  });

  it("pays = code pays à 2 lettres, marketplace = nom du magasin réel — jamais 'open_prices' comme marchand", () => {
    const obs = normalizeOpenPricesItem(item, { categorySlug: "general", query: "x", collectedAt: "2026-09-22T00:00:00.000Z" });
    expect(obs.country).toBe("FR");
    expect(obs.marketplace).toContain("Éléfàn");
  });

  it("aucun nom de produit disponible : repli sur le code-barres, jamais un titre inventé", () => {
    const obs = normalizeOpenPricesItem(item, { categorySlug: "general", query: "x", collectedAt: "2026-09-22T00:00:00.000Z" });
    expect(obs.title).toBe("1541513213246");
  });

  it("condition/completeness toujours null — Open Prices ne rapporte jamais l'état d'un article", () => {
    const obs = normalizeOpenPricesItem(item, { categorySlug: "general", query: "x", collectedAt: "2026-09-22T00:00:00.000Z" });
    expect(obs.condition).toBeNull();
    expect(obs.completeness).toBeNull();
  });
});
