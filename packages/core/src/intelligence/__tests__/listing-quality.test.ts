import { describe, expect, it } from "vitest";
import { isLikelyBundleOrPartsListing } from "../listing-quality";

describe("isLikelyBundleOrPartsListing", () => {
  it("détecte les motifs de lot/bundle/pièces détachées/accessoires seuls, insensible à la casse", () => {
    const positives = [
      "iPhone 14 Pro BUNDLE with case and charger",
      "Lot of 3 LEGO sets",
      "JOB LOT of watches for repair",
      "Nintendo Switch FOR PARTS not working",
      "Camera body SPARES OR REPAIRS",
      "PS5 accessories only",
      "Rolex CASE ONLY",
      "iPhone box only, empty box",
      "Nintendo Switch shell only",
      "Watch parts only",
      "Console broken, powers on but screen dead",
      "Incomplete set missing pieces",
    ];
    for (const title of positives) {
      expect(isLikelyBundleOrPartsListing(title)).toBe(true);
    }
  });

  it("ne signale jamais une annonce normale décrivant un objet complet unique", () => {
    const negatives = [
      "iPhone 14 Pro 256GB Deep Purple Unlocked",
      "LEGO Star Wars 75192 Millennium Falcon New Sealed",
      "Rolex Submariner 116610LN Excellent Condition",
      "Nintendo Switch OLED Console White",
    ];
    for (const title of negatives) {
      expect(isLikelyBundleOrPartsListing(title)).toBe(false);
    }
  });

  it("est une heuristique honnête : ne prétend jamais 100% de rappel (documenté, pas testé comme une garantie)", () => {
    // Un titre qui contredit le motif sans le mot-clé exact échappe à la détection — comportement attendu, pas un bug.
    expect(isLikelyBundleOrPartsListing("Sold as a set of two watches, both working")).toBe(false);
  });
});
