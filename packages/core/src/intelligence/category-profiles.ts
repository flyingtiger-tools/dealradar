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

// ── Extension LOT "Universal Object Valuation Foundation" (2026-09-20) ──
// Même discipline que les 5 profils d'origine : purement déclaratif,
// aucune branche de code spécifique ailleurs. `minSoldComparablesForStrongRecommendation`
// et `confidencePenaltyPerMissingField` calibrés par analogie avec les
// catégories déjà en place (biens à forte variance de valeur selon
// l'état/l'authenticité => seuils plus stricts, comme `pokemon_tcg`/`photo`).

const sneakers: CategoryProfile = {
  slug: "sneakers",
  label: "Sneakers",
  // La pointure change tout : deux paires identiques en tailles différentes ne sont pas comparables.
  requiredAttributeKeys: ["model", "size"],
  similarityAttributeKeys: ["model", "size"],
  riskSignals: [
    {
      id: "counterfeit_keyword",
      description: "Mot-clé à risque de contrefaçon dans le titre",
      penalty: 30,
      test: (l) => /replica|fake|rep(?:s)?\b|1:1|unauthorized/i.test(l.title),
    },
    {
      id: "missing_original_box",
      description: "Boîte d'origine absente (valeur « deadstock » fortement affectée)",
      penalty: 12,
      test: (l) => l.attributes.hasOriginalBox === false,
    },
  ],
  minSoldComparablesForStrongRecommendation: 5,
  confidencePenaltyPerMissingField: 10,
};

const watches: CategoryProfile = {
  slug: "watches",
  label: "Montres",
  requiredAttributeKeys: ["brand", "model"],
  similarityAttributeKeys: ["brand", "model"],
  riskSignals: [
    {
      id: "counterfeit_keyword",
      description: "Mot-clé à risque de contrefaçon dans le titre/description",
      penalty: 35,
      test: (l) => /replica|homage|aftermarket dial|fake/i.test(`${l.title} ${l.description ?? ""}`),
    },
    {
      id: "missing_papers",
      description: "Boîte et/ou papiers d'origine absents",
      penalty: 15,
      test: (l) => l.attributes.hasBoxAndPapers === false,
    },
    {
      id: "servicing_unknown",
      description: "Historique d'entretien/révision inconnu",
      penalty: 8,
      test: (l) => l.attributes.serviceHistoryKnown === false,
    },
  ],
  // Écarts de valeur très sensibles à l'authenticité/la provenance.
  minSoldComparablesForStrongRecommendation: 6,
  confidencePenaltyPerMissingField: 12,
};

const pcComponents: CategoryProfile = {
  slug: "pc_components",
  label: "PC / Composants",
  requiredAttributeKeys: ["componentType", "model"],
  similarityAttributeKeys: ["componentType", "model"],
  riskSignals: [
    {
      id: "mining_wear_risk",
      description: "Usage minage crypto mentionné (usure accélérée probable)",
      penalty: 15,
      test: (l) => /mining|minage|mined|24\/7 mining/i.test(`${l.title} ${l.description ?? ""}`),
    },
    {
      id: "missing_original_packaging",
      description: "Emballage d'origine absent",
      penalty: 6,
      test: (l) => l.attributes.hasOriginalPackaging === false,
    },
    {
      id: "no_warranty_left",
      description: "Garantie constructeur expirée ou non transférable",
      penalty: 5,
      test: (l) => l.attributes.warrantyRemaining === false,
    },
  ],
  minSoldComparablesForStrongRecommendation: 5,
  confidencePenaltyPerMissingField: 10,
};

const collectibles: CategoryProfile = {
  slug: "collectibles",
  label: "Objets de collection",
  // Générique (hors TCG, qui a son propre profil `pokemon_tcg`) — pièces,
  // timbres, comics, memorabilia. `identifier` : édition/année/numéro
  // d'émission selon le type d'objet, fourni par l'extraction, jamais deviné.
  requiredAttributeKeys: ["itemType", "identifier"],
  similarityAttributeKeys: ["itemType", "identifier"],
  riskSignals: [
    {
      id: "unverified_grading",
      description: "Note/certification affichée sans preuve vérifiable",
      penalty: 20,
      test: (l) => l.attributes.grade !== undefined && l.attributes.gradingProofVerified !== true,
    },
    {
      id: "counterfeit_keyword",
      description: "Mot-clé à risque de reproduction/contrefaçon dans le titre",
      penalty: 25,
      test: (l) => /repro(?:duction)?|replica|fake|counterfeit/i.test(l.title),
    },
  ],
  minSoldComparablesForStrongRecommendation: 6,
  confidencePenaltyPerMissingField: 12,
};

const general: CategoryProfile = {
  slug: "general",
  label: "Objet non catégorisé",
  // Volontairement aucun champ requis, aucune similarité au-delà des filtres
  // structurels déjà appliqués par `matchComparables` (catégorie/devise/
  // condition) — c'est le repli explicite pour un objet réel mais sans
  // profil plus spécifique (jamais un blocage total, voir Phase 2 du lot
  // "le pipeline universel doit fonctionner même pour une catégorie
  // inconnue/générique"). Le signal de risque ci-dessous se déclenche
  // TOUJOURS : reflète honnêtement, comme un facteur visible dans le
  // Pourquoi, que l'appariement est structurel seulement (pas de similarité
  // fine) — jamais un simple "-20 sans profil" invisible.
  requiredAttributeKeys: [],
  similarityAttributeKeys: [],
  riskSignals: [
    {
      id: "loosely_matched_category",
      description: "Catégorie générique — appariement structurel uniquement, pas de similarité fine",
      penalty: 15,
      test: () => true,
    },
  ],
  // Seuil relevé : la similarité étant purement structurelle, il faut plus
  // de comparables pour compenser l'absence de filtrage fin.
  minSoldComparablesForStrongRecommendation: 8,
  confidencePenaltyPerMissingField: 10,
};

export const CATEGORY_PROFILES: Record<CategoryProfileSlug, CategoryProfile> = {
  lego,
  pokemon_tcg: pokemonTcg,
  apple,
  gaming,
  photo,
  sneakers,
  watches,
  pc_components: pcComponents,
  collectibles,
  general,
};

export function resolveCategoryProfile(categorySlug: string): CategoryProfile | undefined {
  return CATEGORY_PROFILES[categorySlug as CategoryProfileSlug];
}
