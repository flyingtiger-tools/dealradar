import { describe, expect, it } from "vitest";
import { tcgDatasetSchema, tcgGroundTruthSchema } from "../dataset-schema";

describe("tcgGroundTruthSchema", () => {
  it("accepte une entrée minimale valide (tags par défaut vide)", () => {
    const parsed = tcgGroundTruthSchema.parse({
      id: "nymble-096",
      imagePath: "photos/nymble-096.jpg",
      game: "pokemon",
      cardName: "Nymble",
      setName: "Phantasmal Flames",
      collectorNumber: "096",
      language: "en",
      variant: null,
      productKind: "raw_card",
      gradingCompany: null,
      grade: null,
    });
    expect(parsed.tags).toEqual([]);
  });

  it("cardName vide rejeté — jamais une entrée sans nom exploitable", () => {
    expect(() =>
      tcgGroundTruthSchema.parse({
        id: "x",
        imagePath: "x.jpg",
        game: "pokemon",
        cardName: "",
        setName: null,
        collectorNumber: null,
        language: null,
        variant: null,
        productKind: null,
        gradingCompany: null,
        grade: null,
      }),
    ).toThrow();
  });

  it("tag inconnu rejeté", () => {
    expect(() =>
      tcgGroundTruthSchema.parse({
        id: "x",
        imagePath: "x.jpg",
        game: "pokemon",
        cardName: "Pikachu",
        setName: null,
        collectorNumber: null,
        language: null,
        variant: null,
        productKind: null,
        gradingCompany: null,
        grade: null,
        tags: ["not_a_real_tag"],
      }),
    ).toThrow();
  });

  it("accepte tous les tags documentés", () => {
    const parsed = tcgGroundTruthSchema.parse({
      id: "x",
      imagePath: "x.jpg",
      game: "pokemon",
      cardName: "Pikachu",
      setName: null,
      collectorNumber: null,
      language: null,
      variant: null,
      productKind: null,
      gradingCompany: null,
      grade: null,
      tags: [
        "perfect",
        "glare",
        "low_light",
        "angle",
        "blur",
        "crop",
        "french",
        "english",
        "leading_zero",
        "ambiguous",
        "similar_card",
        "hard_number",
      ],
    });
    expect(parsed.tags).toHaveLength(12);
  });
});

describe("tcgDatasetSchema", () => {
  it("accepte un dataset synthetic vide (structure prête, aucune photo)", () => {
    const parsed = tcgDatasetSchema.parse({ provenance: "synthetic", entries: [] });
    expect(parsed.entries).toEqual([]);
  });

  it("provenance invalide rejetée", () => {
    expect(() => tcgDatasetSchema.parse({ provenance: "fake", entries: [] })).toThrow();
  });
});
