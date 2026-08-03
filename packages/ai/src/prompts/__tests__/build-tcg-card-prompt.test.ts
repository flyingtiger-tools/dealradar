import { describe, expect, it } from "vitest";
import { buildTcgCardPrompt, TCG_CARD_PROMPT_VERSION, TCG_FORBIDDEN_JUDGMENT_KEYWORDS } from "../build-tcg-card-prompt";

describe("buildTcgCardPrompt", () => {
  it("contient la consigne ciblée sur la zone basse et le numéro de collection (LOT 8A)", () => {
    const { system } = buildTcgCardPrompt();
    expect(system).toMatch(/zone basse/i);
    expect(system).toMatch(/numérateur.*total/i);
  });

  it("interdit explicitement de deviner un chiffre ambigu du numéro plutôt que de retourner null/confiance faible", () => {
    const { system } = buildTcgCardPrompt();
    expect(system).toMatch(/ambigu/i);
    expect(system).toMatch(/jamais.*n'invente|n'invente jamais/i);
  });

  it("incrémente TCG_CARD_PROMPT_VERSION suite au changement de texte du prompt (LOT 8A)", () => {
    expect(TCG_CARD_PROMPT_VERSION).toBe(2);
  });

  it("aucun mot-clé de jugement de valeur n'apparaît hors d'une interdiction explicite (non-régression)", () => {
    const { system } = buildTcgCardPrompt();
    const sentences = system.split(/\n/).filter((line) => line.trim().length > 0);
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      const mentionsJudgment = TCG_FORBIDDEN_JUDGMENT_KEYWORDS.some((keyword) => lower.includes(keyword));
      if (mentionsJudgment) {
        expect(/n'exprime jamais|ne donne aucune/i.test(sentence)).toBe(true);
      }
    }
  });

  it("aucun titre/description requis (non-régression)", () => {
    const { userText } = buildTcgCardPrompt();
    expect(userText).not.toContain("undefined");
    expect(userText.length).toBeGreaterThan(0);
  });
});
