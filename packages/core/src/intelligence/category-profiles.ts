import type { CategoryProfile, CategoryProfileSlug } from "./types";

/**
 * Cinq profils de catégorie, purement déclaratifs (ADR 0007) : aucune
 * branche de code spécifique à une catégorie n'existe ailleurs — tout passe
 * par ce contrat, consommé génériquement par identify.ts/comparables.ts/scores.ts.
 */

const lego: CategoryProfile = {
  slug: "lego",
  label: "LEGO",
  // `piecesCount` est intrinsèque au numéro de set (donc redondant pour la
  // similarité, déjà couverte par `setNumber`) mais reste exigé pour une
  // identification complète : son absence signale une fiche mal renseignée.
  requiredAttributeKeys: ["setNumber", "piecesCount"],
  similarityAttributeKeys: ["setNumber"],
  riskSignals: [
    {
      id: "missing_box",
      description: "Boîte d'origine absente",
      penalty: 10,
      test: (l) => l.attributes.hasBox === false,
    },
    {
      id: "incomplete_set",
      description: "Set incomplet (pièces manquantes)",
      penalty: 15,
      test: (l) => l.attributes.complete === false,
    },
  ],
  minSoldComparablesForStrongRecommendation: 5,
  confidencePenaltyPerMissingField: 10,
};

const pokemonTcg: CategoryProfile = {
  slug: "pokemon_tcg",
  label: "Pokémon / TCG",
  requiredAttributeKeys: ["cardName", "setCode"],
  // La note (grade) fait partie de la similarité : une carte brute et une
  // carte gradée PSA10 n'ont rien de comparable, même identiques sinon.
  similarityAttributeKeys: ["cardName", "setCode", "grade"],
  riskSignals: [
    {
      id: "unverified_grading",
      description: "Note affichée sans certificat vérifiable",
      penalty: 20,
      test: (l) => l.attributes.grade !== undefined && l.attributes.gradingProofVerified !== true,
    },
    {
      id: "counterfeit_keyword",
      description: "Mot-clé à risque de contrefaçon dans le titre",
      penalty: 25,
      test: (l) => /proxy|custom|repro/i.test(l.title),
    },
  ],
  // Variance et risque de contrefaçon plus élevés qu'ailleurs → seuil relevé.
  minSoldComparablesForStrongRecommendation: 6,
  confidencePenaltyPerMissingField: 12,
};

const apple: CategoryProfile = {
  slug: "apple",
  label: "Apple",
  requiredAttributeKeys: ["model", "storageGb"],
  similarityAttributeKeys: ["model", "storageGb"],
  riskSignals: [
    {
      id: "icloud_lock_risk",
      description: "Mention de verrouillage iCloud/compte non levé",
      penalty: 40,
      test: (l) => /icloud|find my|compte li[ée]|locked/i.test(`${l.title} ${l.description ?? ""}`),
    },
    {
      id: "low_battery_health",
      description: "Santé de la batterie faible",
      penalty: 10,
      test: (l) => typeof l.attributes.batteryHealthPercent === "number" && l.attributes.batteryHealthPercent < 80,
    },
  ],
  minSoldComparablesForStrongRecommendation: 5,
  confidencePenaltyPerMissingField: 10,
};

const gaming: CategoryProfile = {
  slug: "gaming",
  label: "Gaming",
  requiredAttributeKeys: ["platform", "productName"],
  // La région conditionne la compatibilité/valeur (PAL vs NTSC).
  similarityAttributeKeys: ["platform", "productName", "region"],
  riskSignals: [
    {
      id: "missing_original_case",
      description: "Boîtier ou notice d'origine absents",
      penalty: 8,
      test: (l) => l.attributes.hasOriginalCase === false,
    },
    {
      id: "modded_console",
      description: "Console modifiée mentionnée",
      penalty: 30,
      test: (l) => /modd|jailbreak|hack/i.test(l.title),
    },
  ],
  minSoldComparablesForStrongRecommendation: 5,
  confidencePenaltyPerMissingField: 10,
};

const photo: CategoryProfile = {
  slug: "photo",
  label: "Photo",
  requiredAttributeKeys: ["gearType", "model"],
  // La monture détermine la compatibilité des objectifs — critique en photo.
  similarityAttributeKeys: ["gearType", "model", "mount"],
  riskSignals: [
    {
      id: "high_shutter_count",
      description: "Compteur de déclenchements élevé",
      penalty: 12,
      test: (l) => typeof l.attributes.shutterCount === "number" && l.attributes.shutterCount > 100_000,
    },
    {
      id: "fungus_or_haze",
      description: "Champignon ou voile optique mentionné",
      penalty: 35,
      test: (l) => /fungus|champignon|haze|voile/i.test(`${l.title} ${l.description ?? ""}`),
    },
  ],
  // Écarts de valeur très sensibles à l'état réel (usure capteur/optique).
  minSoldComparablesForStrongRecommendation: 6,
  confidencePenaltyPerMissingField: 12,
};

export const CATEGORY_PROFILES: Record<CategoryProfileSlug, CategoryProfile> = {
  lego,
  pokemon_tcg: pokemonTcg,
  apple,
  gaming,
  photo,
};

export function resolveCategoryProfile(categorySlug: string): CategoryProfile | undefined {
  return CATEGORY_PROFILES[categorySlug as CategoryProfileSlug];
}
