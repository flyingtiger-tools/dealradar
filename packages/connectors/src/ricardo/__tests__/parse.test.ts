import { describe, expect, it } from "vitest";
import { parseRicardoListingHtml } from "../parse";

const CONTEXT = { query: "lego 10300", collectedAt: "2026-09-21T00:00:00.000Z", pageUrl: "https://www.ricardo.ch/de/s/lego%2010300" };

/**
 * Fixture réaliste mais RÉDIGÉE À LA MAIN (jamais capturée en direct sur
 * ricardo.ch, voir l'en-tête de `../parse.ts`) — reprend le vocabulaire
 * standard schema.org `Product`/`Offer` tel qu'un site e-commerce l'émet
 * couramment pour le référencement. Sert uniquement à valider le CONTRAT du
 * parseur, jamais une preuve que Ricardo émet réellement ce balisage.
 */
function fixtureHtml(products: { name: string; price: string; currency: string; sku: string; url: string; condition?: string }[]): string {
  const jsonLd = JSON.stringify(
    products.map((p) => ({
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      sku: p.sku,
      url: p.url,
      offers: {
        "@type": "Offer",
        price: p.price,
        priceCurrency: p.currency,
        availability: "https://schema.org/InStock",
        ...(p.condition ? { itemCondition: p.condition } : {}),
      },
    })),
  );
  return `<html><head><script type="application/ld+json">${jsonLd}</script></head><body>Résultats de recherche</body></html>`;
}

describe("parseRicardoListingHtml", () => {
  it("extrait un produit avec prix/devise/titre/lien depuis un bloc JSON-LD schema.org", () => {
    const html = fixtureHtml([{ name: "LEGO 10300 Back to the Future DeLorean", price: "179.00", currency: "CHF", sku: "1001", url: "https://www.ricardo.ch/de/a/lego-10300-1001" }]);
    const observations = parseRicardoListingHtml(html, CONTEXT);

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      source: "ricardo",
      sourceItemId: "1001",
      sourceUrl: "https://www.ricardo.ch/de/a/lego-10300-1001",
      title: "LEGO 10300 Back to the Future DeLorean",
      priceAmountCents: 17900,
      currency: "CHF",
      country: "CH",
      marketplace: "ricardo",
      evidenceType: "activeListings",
      evidenceTier: "D",
      soldAt: null,
    });
  });

  it("plusieurs produits dans la même page -> plusieurs observations distinctes", () => {
    const html = fixtureHtml([
      { name: "Produit A", price: "10.00", currency: "CHF", sku: "a", url: "https://ricardo.ch/a" },
      { name: "Produit B", price: "20.00", currency: "CHF", sku: "b", url: "https://ricardo.ch/b" },
    ]);
    expect(parseRicardoListingHtml(html, CONTEXT)).toHaveLength(2);
  });

  it("normalise itemCondition schema.org vers le vocabulaire brut DealRadar", () => {
    const html = fixtureHtml([{ name: "P", price: "10.00", currency: "CHF", sku: "x", url: "https://ricardo.ch/x", condition: "https://schema.org/UsedCondition" }]);
    expect(parseRicardoListingHtml(html, CONTEXT)[0]!.condition).toBe("used");
  });

  it("condition non reconnue ou absente -> null, jamais devinée", () => {
    const html = fixtureHtml([{ name: "P", price: "10.00", currency: "CHF", sku: "x", url: "https://ricardo.ch/x" }]);
    expect(parseRicardoListingHtml(html, CONTEXT)[0]!.condition).toBeNull();
  });

  it("produit sans prix exploitable -> ignoré, jamais un prix inventé", () => {
    const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Sans prix", sku: "y" });
    const html = `<script type="application/ld+json">${jsonLd}</script>`;
    expect(parseRicardoListingHtml(html, CONTEXT)).toEqual([]);
  });

  it("aucun bloc JSON-LD dans la page -> tableau vide, jamais une extraction par texte libre", () => {
    expect(parseRicardoListingHtml("<html><body>Rien ici</body></html>", CONTEXT)).toEqual([]);
  });

  it("bloc JSON-LD malformé -> ignoré silencieusement, ne lève jamais", () => {
    const html = `<script type="application/ld+json">{ceci n'est pas du JSON</script>`;
    expect(() => parseRicardoListingHtml(html, CONTEXT)).not.toThrow();
    expect(parseRicardoListingHtml(html, CONTEXT)).toEqual([]);
  });

  it("supporte un bloc JSON-LD enveloppé dans @graph", () => {
    const graph = { "@graph": [{ "@type": "Product", name: "Via graph", sku: "g1", url: "https://ricardo.ch/g1", offers: { price: "5.00", priceCurrency: "CHF" } }] };
    const html = `<script type="application/ld+json">${JSON.stringify(graph)}</script>`;
    const observations = parseRicardoListingHtml(html, CONTEXT);
    expect(observations).toHaveLength(1);
    expect(observations[0]!.title).toBe("Via graph");
  });

  it("jamais evidenceType soldTransactions, jamais soldAt renseigné — Ricardo n'expose ici que des annonces actives", () => {
    const html = fixtureHtml([{ name: "P", price: "10.00", currency: "CHF", sku: "x", url: "https://ricardo.ch/x" }]);
    const observation = parseRicardoListingHtml(html, CONTEXT)[0]!;
    expect(observation.evidenceType).not.toBe("soldTransactions");
    expect(observation.soldAt).toBeNull();
  });
});
