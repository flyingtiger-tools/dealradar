import { describe, expect, it } from "vitest";
import { buildPrompt, redactSerialNumberMentions } from "../build-prompt";

const JUDGMENT_KEYWORDS = ["bonne affaire", "bon prix", "recommandation", "score", "estimation de valeur", "profit"];
const NEGATION_MARKERS = [/n'exprime jamais/i, /ne donne aucune/i, /ne calcule aucun/i];

describe("buildPrompt", () => {
  it("interdit explicitement le jugement de valeur dans le texte du prompt", () => {
    const { system } = buildPrompt({ title: "x", categorySlug: "lego" });
    expect(system).toMatch(/n'exprime jamais d'avis/i);
  });

  it("chaque mention de jugement de valeur dans le prompt système apparaît dans une interdiction explicite, jamais une affirmation", () => {
    const { system } = buildPrompt({ title: "x", categorySlug: "lego" });
    const sentences = system.split(/\n/).filter((line) => line.trim().length > 0);
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      const mentionsJudgment = JUDGMENT_KEYWORDS.some((keyword) => lower.includes(keyword));
      if (mentionsJudgment) {
        expect(NEGATION_MARKERS.some((marker) => marker.test(sentence))).toBe(true);
      }
    }
  });

  it("redacte un numéro de série mentionné dans le titre avant construction du prompt", () => {
    const { userText } = buildPrompt({ title: "Apple iPhone Serial Number: ABCD1234567", categorySlug: "apple" });
    expect(userText).not.toContain("ABCD1234567");
    expect(userText).toContain("masqué");
  });

  it("redacte une mention française de numéro de série", () => {
    const redacted = redactSerialNumberMentions("Numéro de série: XYZ98765");
    expect(redacted).not.toContain("XYZ98765");
  });

  it("inclut la catégorie et le titre dans le texte utilisateur", () => {
    const { userText } = buildPrompt({ title: "LEGO 75313", categorySlug: "lego" });
    expect(userText).toContain("lego");
    expect(userText).toContain("LEGO 75313");
  });
});
