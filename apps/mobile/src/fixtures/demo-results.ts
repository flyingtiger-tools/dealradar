import type { ResultViewModel } from "../screens/result/result-view-model";

/**
 * Fixtures DEMO (Phase 16, LOT "fondation produit Raf") — EXACTEMENT 3,
 * comme demandé : BAD DEAL, GOOD DEAL, MEGA DEAL. `isDemo: true` sur
 * chacune — `ResultScreen` affiche alors un badge "DEMO" bien visible.
 *
 * **Isolation stricte** : ce module n'est importé QUE par
 * `screens/internal/UiPreviewScreen.tsx`, lui-même accessible uniquement
 * depuis Internal Tools (`INTERNAL_TOOLS_ENABLED`). Aucun écran
 * consommateur (Home/Scanner/Historique/Favoris/Profil) ne doit jamais
 * importer ce fichier — voir le test `demo-results-isolation.test.ts`, qui
 * échoue si une importation apparaît en dehors de `screens/internal/`.
 *
 * Ces trois résultats sont fictifs : `decision`/`dealScore` y sont
 * REMPLIS uniquement pour donner à voir, en Internal UI Preview, à quoi
 * ressemblera l'écran de résultat une fois qu'un flux produira réellement
 * ces champs pour une carte TCG (aujourd'hui, aucun flux réel ne les
 * fournit — voir `result-view-model.ts`).
 */

const BASE_PRICE_ROW = {
  source: "tcgdex",
  currency: "CHF",
  condition: "near_mint",
  updatedAt: new Date().toISOString(),
  convertedAmountCents: null,
  convertedCurrency: null,
};

export const DEMO_BAD_DEAL: ResultViewModel = {
  identityStatus: "identified",
  product: {
    name: "Dracaufeu (DEMO)",
    setName: "Base Set",
    collectorNumber: "4",
    language: "en",
    variant: "holo",
    productKind: "raw_card",
    gradingCompany: null,
    grade: null,
  },
  confidencePercent: 62,
  prices: [{ ...BASE_PRICE_ROW, amountCents: 45000 }],
  hasPricing: true,
  warnings: ["Peu de ventes récentes comparables", "Identification partiellement incertaine"],
  reasonMessage: null,
  decision: "PASS",
  dealScore: 22,
  reasons: [],
  isDemo: true,
};

export const DEMO_GOOD_DEAL: ResultViewModel = {
  identityStatus: "identified",
  product: {
    name: "Pikachu (DEMO)",
    setName: "Base Set",
    collectorNumber: "58",
    language: "en",
    variant: null,
    productKind: "raw_card",
    gradingCompany: null,
    grade: null,
  },
  confidencePercent: 91,
  prices: [{ ...BASE_PRICE_ROW, amountCents: 963 }],
  hasPricing: true,
  warnings: [],
  reasonMessage: null,
  decision: "BUY",
  dealScore: 78,
  reasons: ["Prix sous le marché", "Comparables cohérents"],
  isDemo: true,
};

export const DEMO_MEGA_DEAL: ResultViewModel = {
  identityStatus: "identified",
  product: {
    name: "Salamèche Illustrator (DEMO)",
    setName: "Promo",
    collectorNumber: "—",
    language: "jp",
    variant: null,
    productKind: "graded_card",
    gradingCompany: "PSA",
    grade: "10",
  },
  confidencePercent: 97,
  prices: [{ ...BASE_PRICE_ROW, amountCents: 12500000, currency: "CHF" }],
  hasPricing: true,
  warnings: [],
  reasonMessage: null,
  decision: "BUY",
  dealScore: 99,
  reasons: ["Prix très en dessous du marché", "Demande solide", "Comparables cohérents"],
  isDemo: true,
};

export const DEMO_RESULT_FIXTURES = [
  { key: "badDeal", label: "BAD DEAL", view: DEMO_BAD_DEAL },
  { key: "goodDeal", label: "GOOD DEAL", view: DEMO_GOOD_DEAL },
  { key: "megaDeal", label: "MEGA DEAL", view: DEMO_MEGA_DEAL },
] as const;
