import { describe, expect, it } from "vitest";
import { computeImageFingerprint } from "../image-fingerprint";

describe("computeImageFingerprint", () => {
  it("utilise le hash de contenu quand toutes les images en ont un", () => {
    const result = computeImageFingerprint([
      { url: "https://a.example.com/1.jpg", position: 0, contentHash: "hash-1" },
      { url: "https://a.example.com/2.jpg", position: 1, contentHash: "hash-2" },
    ]);
    expect(result.usedContentHash).toBe(true);
  });

  it("retombe sur les URLs triées si au moins une image n'a pas de hash", () => {
    const result = computeImageFingerprint([
      { url: "https://a.example.com/1.jpg", position: 0, contentHash: "hash-1" },
      { url: "https://a.example.com/2.jpg", position: 1 },
    ]);
    expect(result.usedContentHash).toBe(false);
  });

  it("même URL mais fingerprint de contenu différent produit des empreintes différentes", () => {
    const a = computeImageFingerprint([{ url: "https://a.example.com/1.jpg", position: 0, contentHash: "hash-v1" }]);
    const b = computeImageFingerprint([{ url: "https://a.example.com/1.jpg", position: 0, contentHash: "hash-v2" }]);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("est stable indépendamment de l'ordre d'entrée (trié par URL)", () => {
    const a = computeImageFingerprint([
      { url: "https://a.example.com/2.jpg", position: 1, contentHash: "h2" },
      { url: "https://a.example.com/1.jpg", position: 0, contentHash: "h1" },
    ]);
    const b = computeImageFingerprint([
      { url: "https://a.example.com/1.jpg", position: 0, contentHash: "h1" },
      { url: "https://a.example.com/2.jpg", position: 1, contentHash: "h2" },
    ]);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
