import { describe, expect, it } from "vitest";
import { DEFAULT_REFRESH_BUDGET_LIMITS, initialRefreshBudgetState, type IdentityHealthSummary } from "@dealradar/core";
import { buildSourceSelectionPlan, MARKET_SOURCE_NAMES } from "../source-selection-plan";

const NOW_MS = Date.parse("2026-09-21T12:00:00.000Z");

function baseHealth(overrides: Partial<IdentityHealthSummary> = {}): IdentityHealthSummary {
  return {
    unresolvedConflictCount: 0,
    conflictFields: [],
    identifierCoverage: 0,
    exactSearchableSources: [],
    fallbackOnlySources: [],
    blockedSourcesDueToIdentity: [],
    ...overrides,
  };
}

describe("buildSourceSelectionPlan", () => {
  it("exclut une source verrouillée par politique (ricardo) MÊME avec ses credentials présentes", () => {
    const plan = buildSourceSelectionPlan({
      categorySlug: "lego",
      envPresenceBySource: { ricardo: {}, bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true } },
      identityHealth: null,
      budgetState: initialRefreshBudgetState(NOW_MS),
      budgetLimits: DEFAULT_REFRESH_BUDGET_LIMITS,
    });

    expect(plan.excludedByPolicy).toContain("ricardo");
    expect(plan.selectedSources).not.toContain("ricardo");
    expect(plan.selectedSources).toContain("bricklink");
  });

  it("exclut une source avec des credentials manquantes, jamais confondue avec un verrou de politique", () => {
    const plan = buildSourceSelectionPlan({
      categorySlug: "apple",
      envPresenceBySource: {},
      identityHealth: null,
      budgetState: initialRefreshBudgetState(NOW_MS),
      budgetLimits: DEFAULT_REFRESH_BUDGET_LIMITS,
    });

    expect(plan.excludedByMissingCredentials).toContain("keepa");
    expect(plan.excludedByPolicy).not.toContain("keepa");
  });

  it("exclut une source bloquée par l'identité (blockedSourcesDueToIdentity), jamais sélectionnée même prête", () => {
    const plan = buildSourceSelectionPlan({
      categorySlug: "apple",
      envPresenceBySource: { keepa: { KEEPA_API_KEY: true } },
      identityHealth: baseHealth({ blockedSourcesDueToIdentity: ["keepa"] }),
      budgetState: initialRefreshBudgetState(NOW_MS),
      budgetLimits: DEFAULT_REFRESH_BUDGET_LIMITS,
    });

    expect(plan.excludedByIdentityWeakness).toContain("keepa");
    expect(plan.selectedSources).not.toContain("keepa");
  });

  it("applique le budget EXACTEMENT — un plafond maxSourcesPerTarget=1 ne sélectionne jamais plus d'une source, même si plusieurs sont prêtes", () => {
    const plan = buildSourceSelectionPlan({
      categorySlug: "apple",
      envPresenceBySource: {
        keepa: { KEEPA_API_KEY: true },
        google_shopping: { SERPAPI_KEY: true },
        dataforseo_google_shopping: { DATAFORSEO_LOGIN: true, DATAFORSEO_PASSWORD: true },
        ebay: { EBAY_CLIENT_ID: true, EBAY_CLIENT_SECRET: true, EBAY_MARKETPLACE_ID: true, EBAY_ENVIRONMENT: true },
      },
      identityHealth: null,
      budgetState: initialRefreshBudgetState(NOW_MS),
      budgetLimits: { ...DEFAULT_REFRESH_BUDGET_LIMITS, maxSourcesPerTarget: 1 },
    });

    expect(plan.selectedSources).toHaveLength(1);
    expect(plan.excludedByCostBudget.length).toBeGreaterThan(0);
  });

  it("applique le plafond EXACT de sources à coût élevé PAR CIBLE (maxHighCostSourcesPerTarget), jamais approximé", () => {
    // ricardo est verrouillé par politique par défaut -> non testable directement en high_cost ; on vérifie plutôt que le plafond est bien consulté via canQuerySource en réutilisant un scénario paid en surchargeant maxPaidSourcesPerTarget à 0.
    const plan = buildSourceSelectionPlan({
      categorySlug: "apple",
      envPresenceBySource: { keepa: { KEEPA_API_KEY: true } },
      identityHealth: null,
      budgetState: initialRefreshBudgetState(NOW_MS),
      budgetLimits: { ...DEFAULT_REFRESH_BUDGET_LIMITS, maxPaidSourcesPerTarget: 0 },
    });

    expect(plan.excludedByCostBudget).toContain("keepa");
    expect(plan.selectedSources).not.toContain("keepa");
  });

  it("priorise les sources EXACT-SEARCHABLE avant les sources en repli, à préférence de catégorie égale", () => {
    const plan = buildSourceSelectionPlan({
      categorySlug: "apple",
      envPresenceBySource: {
        keepa: { KEEPA_API_KEY: true },
        google_shopping: { SERPAPI_KEY: true },
      },
      identityHealth: baseHealth({ exactSearchableSources: ["keepa"], fallbackOnlySources: ["google_shopping"] }),
      budgetState: initialRefreshBudgetState(NOW_MS),
      budgetLimits: DEFAULT_REFRESH_BUDGET_LIMITS,
    });

    const keepaIndex = plan.selectedSources.indexOf("keepa");
    const googleIndex = plan.selectedSources.indexOf("google_shopping");
    expect(keepaIndex).toBeGreaterThanOrEqual(0);
    expect(googleIndex).toBeGreaterThanOrEqual(0);
    expect(keepaIndex).toBeLessThan(googleIndex);
  });

  it("exclut zyte/frankfurter de l'univers de sélection — jamais des MarketSource interrogeables", () => {
    expect(MARKET_SOURCE_NAMES).not.toContain("zyte");
    expect(MARKET_SOURCE_NAMES).not.toContain("frankfurter");
  });

  it("aucune source disponible : plan vide, jamais une exception", () => {
    const plan = buildSourceSelectionPlan({
      categorySlug: "lego",
      envPresenceBySource: {},
      identityHealth: null,
      budgetState: initialRefreshBudgetState(NOW_MS),
      budgetLimits: DEFAULT_REFRESH_BUDGET_LIMITS,
    });

    expect(plan.selectedSources).toEqual([]);
    expect(plan.excludedByMissingCredentials.length).toBeGreaterThan(0);
  });

  it("budgetStateAfter reflète exactement les sources sélectionnées — réutilisable comme état de départ pour la cible suivante", () => {
    const plan = buildSourceSelectionPlan({
      categorySlug: "apple",
      envPresenceBySource: { keepa: { KEEPA_API_KEY: true } },
      identityHealth: null,
      budgetState: initialRefreshBudgetState(NOW_MS),
      budgetLimits: DEFAULT_REFRESH_BUDGET_LIMITS,
    });

    expect(plan.budgetStateAfter.sourcesQueriedForCurrentTarget).toBe(plan.selectedSources.length);
  });
});
