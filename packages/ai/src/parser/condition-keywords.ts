import type { ItemCondition } from "@dealradar/contracts";

/**
 * Détection de condition par mots-clés (FR/EN) — heuristique, confiance
 * volontairement modérée (0.75) : jamais présentée comme une certitude.
 * Un mot-clé non reconnu ne produit aucune supposition (retourne `null`).
 */
const CONDITION_KEYWORDS: Array<{ condition: ItemCondition; patterns: RegExp[] }> = [
  { condition: "for_parts", patterns: [/pour pi[eè]ces/i, /hors service/i, /for parts/i, /not working/i, /\bHS\b/] },
  { condition: "new", patterns: [/\bneuf\b/i, /\bnew\b/i, /scell[ée]e?/i, /still sealed/i, /brand new/i] },
  { condition: "like_new", patterns: [/comme neuf/i, /like new/i, /jamais utilis[ée]e?/i, /never used/i] },
  { condition: "very_good", patterns: [/tr[eè]s bon [ée]tat/i, /very good condition/i] },
  { condition: "fair", patterns: [/[ée]tat correct/i, /fair condition/i, /usure visible/i] },
  { condition: "good", patterns: [/bon [ée]tat/i, /good condition/i] },
];

export const DETERMINISTIC_CONDITION_CONFIDENCE = 0.75;

export function detectConditionKeyword(text: string): { condition: ItemCondition; confidence: number } | null {
  for (const entry of CONDITION_KEYWORDS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return { condition: entry.condition, confidence: DETERMINISTIC_CONDITION_CONFIDENCE };
    }
  }
  return null;
}
