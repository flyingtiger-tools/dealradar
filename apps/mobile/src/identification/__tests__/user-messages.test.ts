import { cleanUserMessage } from "../user-messages";

describe("cleanUserMessage", () => {
  it("null/undefined/chaîne vide : jamais un message inventé, toujours null", () => {
    expect(cleanUserMessage(null)).toBeNull();
    expect(cleanUserMessage(undefined)).toBeNull();
    expect(cleanUserMessage("")).toBeNull();
    expect(cleanUserMessage("   ")).toBeNull();
  });

  it("'Network request failed' brut : jamais affiché tel quel, message réseau clair", () => {
    expect(cleanUserMessage("TypeError: Network request failed")).toBe(
      "Impossible de joindre le service — vérifie ta connexion et réessaie.",
    );
  });

  it("'Délai dépassé' brut : message de lenteur, jamais le texte technique exact", () => {
    const raw = "Délai dépassé — l'analyse n'a pas abouti à temps.";
    expect(cleanUserMessage(raw)).not.toBe(raw);
    expect(cleanUserMessage(raw)).toBe("Le service met plus de temps que prévu à répondre — réessaie dans un instant.");
  });

  it("session absente : invite explicite à se reconnecter", () => {
    expect(cleanUserMessage("Aucune session active — connecte-toi avant d'envoyer une photo.")).toBe(
      "Session expirée — reconnecte-toi puis réessaie.",
    );
  });

  it("carte identifiée sans pricing : message positif, jamais un échec", () => {
    expect(cleanUserMessage("Aucune source de pricing n'a produit de correspondance exacte — jamais exploité automatiquement.")).toBe(
      "Carte identifiée, mais aucun prix disponible pour le moment.",
    );
  });

  it("message technique non reconnu : jamais exposé brut, repli générique honnête", () => {
    const raw = "ECONNREFUSED 127.0.0.1:5432 at TCPConnectWrap.afterConnect";
    const cleaned = cleanUserMessage(raw);
    expect(cleaned).not.toBe(raw);
    expect(cleaned).not.toContain("ECONNREFUSED");
    expect(cleaned).not.toContain("TCPConnectWrap");
    expect(cleaned).toBe("Une erreur est survenue — réessaie dans un instant.");
  });

  it("jamais 'pokemon_tcg' ni 'status failed' ni une pile d'erreur exposés dans la sortie, quel que soit l'input", () => {
    const inputs = [
      "pokemon_tcg",
      "status: failed",
      "Error: something\n    at Object.<anonymous> (/app/index.js:1:1)",
      "Network request failed",
    ];
    for (const raw of inputs) {
      const cleaned = cleanUserMessage(raw);
      expect(cleaned).not.toContain("pokemon_tcg");
      expect(cleaned).not.toContain("status: failed");
      expect(cleaned).not.toContain("at Object");
    }
  });
});
