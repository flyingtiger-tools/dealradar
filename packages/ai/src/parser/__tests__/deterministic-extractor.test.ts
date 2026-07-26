import { describe, expect, it } from "vitest";
import { runDeterministicExtractor } from "../deterministic-extractor";
import { isSufficientForIdentification } from "../requirement-profiles";

describe("runDeterministicExtractor", () => {
  it("identifie un set LEGO explicite sans appel IA (setNumber seul, condition absente)", () => {
    const { product } = runDeterministicExtractor({ title: "LEGO Star Wars 75313 AT-AT", categorySlug: "lego" });
    expect(product.brand?.value).toBe("LEGO");
    expect(product.attributes.setNumber?.value).toBe("75313");
    expect(product.condition).toBeNull();
    expect(isSufficientForIdentification(product.attributes, "lego")).toBe(true);
  });

  it("identifie un produit Apple (modèle + capacité)", () => {
    const { product } = runDeterministicExtractor({ title: "Apple iPhone 13 Pro Max 256GB", categorySlug: "apple" });
    expect(product.brand?.value).toBe("Apple");
    expect(product.attributes.storageGb?.value).toBe(256);
    expect(isSufficientForIdentification(product.attributes, "apple")).toBe(true);
  });

  it("convertit correctement les téraoctets en gigaoctets pour Apple", () => {
    const { product } = runDeterministicExtractor({ title: "Apple MacBook Pro 1TB", categorySlug: "apple" });
    expect(product.attributes.storageGb?.value).toBe(1024);
  });

  it("identifie une carte Pokémon avec un format canonique (nom + fraction)", () => {
    const { product } = runDeterministicExtractor({ title: "Pokémon Dracaufeu VMAX 020/189", categorySlug: "pokemon_tcg" });
    expect(product.attributes.setCode?.value).toBe("020/189");
    expect(product.attributes.cardName?.value).toContain("Dracaufeu");
    expect(isSufficientForIdentification(product.attributes, "pokemon_tcg")).toBe(true);
  });

  it("ne trouve pas de carte Pokémon exploitable sans fraction set/numéro", () => {
    const { product } = runDeterministicExtractor({ title: "Belle carte Pokémon rare à identifier", categorySlug: "pokemon_tcg" });
    expect(product.attributes.setCode).toBeUndefined();
    expect(isSufficientForIdentification(product.attributes, "pokemon_tcg")).toBe(false);
  });

  it("identifie une plateforme et un titre de jeu gaming", () => {
    const { product } = runDeterministicExtractor({ title: "PS5 God of War Ragnarök", categorySlug: "gaming" });
    expect(product.attributes.platform?.value).toBe("PS5");
    expect(product.attributes.productName?.value).toContain("God of War");
    expect(isSufficientForIdentification(product.attributes, "gaming")).toBe(true);
  });

  it("identifie une marque et un modèle photo, en distinguant objectif et boîtier", () => {
    const { product } = runDeterministicExtractor({ title: "Canon EOS R6", categorySlug: "photo" });
    expect(product.brand?.value).toBe("Canon");
    expect(product.attributes.gearType?.value).toBe("camera_body");
    expect(isSufficientForIdentification(product.attributes, "photo")).toBe(true);

    const lens = runDeterministicExtractor({ title: "Canon objectif 50mm f/1.8", categorySlug: "photo" });
    expect(lens.product.attributes.gearType?.value).toBe("lens");
  });

  it("détecte une condition par mot-clé sans jamais deviner une condition non mentionnée", () => {
    const good = runDeterministicExtractor({ title: "LEGO 75313 en très bon état", categorySlug: "lego" });
    expect(good.product.condition?.value).toBe("very_good");

    const unknown = runDeterministicExtractor({ title: "LEGO 75313", categorySlug: "lego" });
    expect(unknown.product.condition).toBeNull();
  });

  it("détecte une mention de numéro de série sans jamais extraire sa valeur", () => {
    const { product } = runDeterministicExtractor({
      title: "Apple iPhone 13 256GB",
      description: "Numéro de série: ABCD1234567",
      categorySlug: "apple",
    });
    expect(product.serialNumberDetected.value).toBe(true);
    expect(JSON.stringify(product)).not.toContain("ABCD1234567");
  });

  it("ne produit aucune extraction spécifique pour une catégorie inconnue", () => {
    const { product } = runDeterministicExtractor({ title: "Objet quelconque", categorySlug: "unknown_category" });
    expect(product.brand).toBeNull();
    expect(isSufficientForIdentification(product.attributes, "unknown_category")).toBe(false);
  });
});
