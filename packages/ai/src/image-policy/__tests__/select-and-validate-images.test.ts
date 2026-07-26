import { describe, expect, it } from "vitest";
import { selectAllowedImages } from "../select-and-validate-images";

describe("selectAllowedImages", () => {
  const allowedDomains = ["i.ebayimg.com"];

  it("accepte une image HTTPS sur un domaine autorisé", () => {
    const result = selectAllowedImages([{ url: "https://i.ebayimg.com/images/g/abc/s-l500.jpg", position: 0 }], {
      allowedDomains,
    });
    expect(result).toHaveLength(1);
  });

  it("ignore une image en HTTP (non sécurisée)", () => {
    const result = selectAllowedImages([{ url: "http://i.ebayimg.com/images/g/abc/s-l500.jpg", position: 0 }], {
      allowedDomains,
    });
    expect(result).toHaveLength(0);
  });

  it("ignore un domaine hors allowlist sans faire échouer la sélection", () => {
    const result = selectAllowedImages(
      [
        { url: "https://evil.example.com/phishing.jpg", position: 0 },
        { url: "https://i.ebayimg.com/images/g/abc/s-l500.jpg", position: 1 },
      ],
      { allowedDomains },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toContain("ebayimg.com");
  });

  it("accepte un sous-domaine du domaine autorisé", () => {
    const result = selectAllowedImages([{ url: "https://thumbs.ebayimg.com/x.jpg", position: 0 }], {
      allowedDomains: ["ebayimg.com"],
    });
    expect(result).toHaveLength(1);
  });

  it("plafonne le nombre d'images retournées", () => {
    const images = Array.from({ length: 10 }, (_, i) => ({ url: `https://i.ebayimg.com/${i}.jpg`, position: i }));
    const result = selectAllowedImages(images, { allowedDomains, maxImages: 4 });
    expect(result).toHaveLength(4);
  });

  it("trie par position avant de plafonner", () => {
    const images = [
      { url: "https://i.ebayimg.com/3.jpg", position: 3 },
      { url: "https://i.ebayimg.com/1.jpg", position: 1 },
      { url: "https://i.ebayimg.com/2.jpg", position: 2 },
    ];
    const result = selectAllowedImages(images, { allowedDomains, maxImages: 2 });
    expect(result.map((r) => r.position)).toEqual([1, 2]);
  });

  it("ignore une URL invalide sans crasher", () => {
    const result = selectAllowedImages([{ url: "not-a-valid-url", position: 0 }], { allowedDomains });
    expect(result).toHaveLength(0);
  });
});
