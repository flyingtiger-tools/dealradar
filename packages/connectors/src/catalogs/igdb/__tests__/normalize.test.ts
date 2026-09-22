import { describe, expect, it } from "vitest";
import { normalizeIgdbGame, matchIgdbGame } from "../normalize";
import { HALO_INFINITE, MINIMAL_GAME } from "./fixtures/games";

describe("normalizeIgdbGame", () => {
  it("champs d'identité reportés tels quels, jamais un prix", () => {
    const item = normalizeIgdbGame(HALO_INFINITE, "gaming");
    expect(item.source).toBe("igdb");
    expect(item.externalId).toBe("126459");
    expect(item.kind).toBe("video_game");
    expect(item.name).toBe("Halo Infinite");
    expect(item.canonicalAttributes.platforms).toBe("PC (Microsoft Windows),Xbox Series X|S");
    expect(item.priceHints).toBeUndefined();
  });

  it("date de sortie : epoch Unix secondes converti en ISO, jamais un nombre brut exposé", () => {
    const item = normalizeIgdbGame(HALO_INFINITE, "gaming");
    expect(item.canonicalAttributes.firstReleaseDate).toBe(new Date(1638921600 * 1000).toISOString());
  });

  it("URL de couverture protocole-relative (//...) rendue absolue (https://...)", () => {
    const item = normalizeIgdbGame(HALO_INFINITE, "gaming");
    expect(item.images).toEqual(["https://images.igdb.com/igdb/image/upload/t_thumb/co3zkr.jpg"]);
  });

  it("URL externe construite depuis le slug — jamais devinée si le slug est absent", () => {
    const item = normalizeIgdbGame(HALO_INFINITE, "gaming");
    expect(item.externalUrl).toBe("https://www.igdb.com/games/halo-infinite");
    const minimal = normalizeIgdbGame(MINIMAL_GAME, "gaming");
    expect(minimal.externalUrl).toBeNull();
  });

  it("jeu minimal (champs optionnels absents) : jamais un crash, replis honnêtes", () => {
    const item = normalizeIgdbGame(MINIMAL_GAME, "gaming");
    expect(item.name).toBe("1");
    expect(item.canonicalAttributes.platforms).toBeNull();
    expect(item.images).toEqual([]);
  });
});

describe("matchIgdbGame", () => {
  it("confiance 1, matchedOn=['title'] — correspondance exacte déjà faite côté serveur (where name = ...)", () => {
    const match = matchIgdbGame(HALO_INFINITE, "gaming");
    expect(match.confidence).toBe(1);
    expect(match.matchedOn).toEqual(["title"]);
  });
});
