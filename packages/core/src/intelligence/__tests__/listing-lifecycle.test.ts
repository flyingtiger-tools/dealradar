import { describe, expect, it } from "vitest";
import {
  initListingLifecycle,
  recordListingObservation,
  markListingNotObservedIfDue,
  reconcileListingLifecycles,
} from "../listing-lifecycle";

describe("initListingLifecycle", () => {
  it("initialise avec observedCount=1, currentlySeen=true, jamais de vente déduite", () => {
    const state = initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z" });
    expect(state.observedCount).toBe(1);
    expect(state.currentlySeen).toBe(true);
    expect(state.disappearedAt).toBeNull();
    expect(state.confirmedSoldAt).toBeNull();
  });

  it("préserve une confirmation de vente EXPLICITE fournie par l'appelant dès le premier événement", () => {
    const state = initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z", confirmedSoldAt: "2026-09-01T00:00:00.000Z" });
    expect(state.confirmedSoldAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("recordListingObservation", () => {
  it("incrémente observedCount, met à jour lastSeenAt, remet currentlySeen à true", () => {
    const initial = initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z" });
    const updated = recordListingObservation(initial, { observedAt: "2026-09-02T00:00:00.000Z" });
    expect(updated.observedCount).toBe(2);
    expect(updated.lastSeenAt).toBe("2026-09-02T00:00:00.000Z");
    expect(updated.firstSeenAt).toBe("2026-09-01T00:00:00.000Z"); // jamais modifié
    expect(updated.currentlySeen).toBe(true);
  });

  it("une réapparition efface disappearedAt (une nouvelle observation n'est jamais un mensonge)", () => {
    const disappeared = { ...initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z" }), currentlySeen: false, disappearedAt: "2026-09-01T00:00:00.000Z" };
    const reappeared = recordListingObservation(disappeared, { observedAt: "2026-09-10T00:00:00.000Z" });
    expect(reappeared.currentlySeen).toBe(true);
    expect(reappeared.disappearedAt).toBeNull();
  });

  it("une vente confirmée, une fois connue, n'est JAMAIS effacée par une observation ultérieure sans confirmation", () => {
    const sold = initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z", confirmedSoldAt: "2026-09-01T00:00:00.000Z" });
    const later = recordListingObservation(sold, { observedAt: "2026-09-02T00:00:00.000Z" }); // pas de confirmedSoldAt cette fois
    expect(later.confirmedSoldAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("markListingNotObservedIfDue — RÈGLE ABSOLUE : disparition != vente", () => {
  it("annonce absente depuis MOINS que la règle : reste currentlySeen=true, jamais marquée prématurément", () => {
    const state = initListingLifecycle("ebay:1", { observedAt: "2026-09-20T00:00:00.000Z" });
    const result = markListingNotObservedIfDue(state, "2026-09-20T12:00:00.000Z", 48);
    expect(result.currentlySeen).toBe(true);
    expect(result.disappearedAt).toBeNull();
  });

  it("annonce absente depuis AU MOINS la règle : currentlySeen=false, disappearedAt=lastSeenAt, JAMAIS soldAt/confirmedSoldAt", () => {
    const state = initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z" });
    const result = markListingNotObservedIfDue(state, "2026-09-10T00:00:00.000Z", 48);
    expect(result.currentlySeen).toBe(false);
    expect(result.disappearedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result.confirmedSoldAt).toBeNull(); // JAMAIS déduit de la disparition
  });

  it("une annonce déjà marquée disparue n'est jamais retraitée (disappearedAt stable)", () => {
    const disappeared = { ...initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z" }), currentlySeen: false, disappearedAt: "2026-09-01T00:00:00.000Z" };
    const result = markListingNotObservedIfDue(disappeared, "2026-09-30T00:00:00.000Z", 48);
    expect(result).toEqual(disappeared);
  });

  it("100 cycles de disparition consécutifs ne produisent jamais un statut de vente confirmée — preuve explicite exigée par le lot", () => {
    let state = initListingLifecycle("ebay:1", { observedAt: "2026-01-01T00:00:00.000Z" });
    for (let day = 1; day <= 100; day += 1) {
      const asOf = new Date(Date.parse("2026-01-01T00:00:00.000Z") + day * 24 * 60 * 60 * 1000).toISOString();
      state = markListingNotObservedIfDue(state, asOf, 48);
    }
    expect(state.confirmedSoldAt).toBeNull();
    expect(state.currentlySeen).toBe(false);
  });
});

describe("reconcileListingLifecycles", () => {
  it("nouvelles annonces observées ce cycle sont initialisées", () => {
    const result = reconcileListingLifecycles({
      previousStates: [],
      observedThisCycle: new Map([["ebay:1", { observedAt: "2026-09-21T00:00:00.000Z" }]]),
      asOf: "2026-09-21T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.observedCount).toBe(1);
  });

  it("annonces revues ce cycle sont mises à jour, jamais réinitialisées", () => {
    const previous = initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z" });
    const result = reconcileListingLifecycles({
      previousStates: [previous],
      observedThisCycle: new Map([["ebay:1", { observedAt: "2026-09-21T00:00:00.000Z" }]]),
      asOf: "2026-09-21T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    expect(result[0]!.observedCount).toBe(2);
    expect(result[0]!.firstSeenAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("annonces absentes ce cycle ET au-delà de la règle sont marquées disparues, jamais vendues", () => {
    const previous = initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z" });
    const result = reconcileListingLifecycles({
      previousStates: [previous],
      observedThisCycle: new Map(),
      asOf: "2026-09-10T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    expect(result[0]!.currentlySeen).toBe(false);
    expect(result[0]!.confirmedSoldAt).toBeNull();
  });

  it("idempotent : ré-exécuter avec les mêmes entrées produit le même résultat", () => {
    const previous = initListingLifecycle("ebay:1", { observedAt: "2026-09-01T00:00:00.000Z" });
    const input = { previousStates: [previous], observedThisCycle: new Map([["ebay:1", { observedAt: "2026-09-02T00:00:00.000Z" }]]), asOf: "2026-09-02T00:00:00.000Z", disappearanceRuleHours: 48 };
    const first = reconcileListingLifecycles(input);
    const second = reconcileListingLifecycles({ ...input, previousStates: [previous] }); // même point de départ
    expect(first).toEqual(second);
  });

  it("une vente confirmée transmise explicitement ce cycle est retenue, jamais fabriquée pour les autres", () => {
    const result = reconcileListingLifecycles({
      previousStates: [],
      observedThisCycle: new Map([
        ["ebay:sold", { observedAt: "2026-09-21T00:00:00.000Z", confirmedSoldAt: "2026-09-21T00:00:00.000Z" }],
        ["ebay:active", { observedAt: "2026-09-21T00:00:00.000Z" }],
      ]),
      asOf: "2026-09-21T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    const sold = result.find((r) => r.listingKey === "ebay:sold")!;
    const active = result.find((r) => r.listingKey === "ebay:active")!;
    expect(sold.confirmedSoldAt).toBe("2026-09-21T00:00:00.000Z");
    expect(active.confirmedSoldAt).toBeNull();
  });
});
