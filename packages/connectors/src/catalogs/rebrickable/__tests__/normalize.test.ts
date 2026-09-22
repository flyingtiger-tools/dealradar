import { describe, expect, it } from "vitest";
import { normalizeRebrickableSet, matchRebrickableSet } from "../normalize";
import { DELOREAN_SET, MINIMAL_SET } from "./fixtures/sets";

describe("normalizeRebrickableSet", () => {
  it("champs d'identité reportés tels quels, jamais un prix", () => {
    const item = normalizeRebrickableSet(DELOREAN_SET);
    expect(item.source).toBe("rebrickable");
    expect(item.externalId).toBe("10300-1");
    expect(item.kind).toBe("lego_set");
    expect(item.categorySlug).toBe("lego");
    expect(item.name).toBe("Back to the Future Time Machine");
    expect(item.canonicalAttributes).toEqual({
      setNumber: "10300-1",
      year: 2020,
      themeId: 682,
      numParts: 1872,
      lastModifiedAt: "2020-09-01T12:00:00.000Z",
    });
    expect(item.images).toEqual(["https://cdn.rebrickable.com/media/sets/10300-1.jpg"]);
    expect(item.externalUrl).toBe("https://rebrickable.com/sets/10300-1/back-to-the-future-time-machine/");
    expect(item.priceHints).toBeUndefined();
  });

  it("set minimal (champs optionnels absents) : jamais un crash, replis honnêtes", () => {
    const item = normalizeRebrickableSet(MINIMAL_SET);
    expect(item.name).toBe("6608-1"); // repli sur le numéro de set, jamais un nom inventé
    expect(item.canonicalAttributes.year).toBeNull();
    expect(item.images).toEqual([]);
    expect(item.externalUrl).toBeNull();
  });
});

describe("matchRebrickableSet", () => {
  it("confiance 1, matchedOn=['setNumber'] — correspondance exacte uniquement", () => {
    const match = matchRebrickableSet(DELOREAN_SET);
    expect(match.confidence).toBe(1);
    expect(match.matchedOn).toEqual(["setNumber"]);
  });
});
