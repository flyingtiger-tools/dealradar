/**
 * Cycle de vie d'annonce SANS vente fabriquée (LOT "Historical Data
 * Engine", section 7) — fonctions PURES, aucune I/O. Suit combien de fois
 * et depuis quand une annonce ACTIVE précise a été observée, à travers des
 * cycles d'instantanés successifs (voir le futur moteur d'instantanés,
 * `packages/ingestion`).
 *
 * RÈGLE ABSOLUE, répétée et appliquée strictement ici :
 * `disappearedAt !== soldAt`. Une annonce qui cesse d'être observée
 * devient "non revue depuis", JAMAIS "vendue". `confirmedSoldAt` ne peut
 * être renseigné QUE si un appelant transmet explicitement une
 * confirmation de vente provenant de la source elle-même (ex.
 * `evidenceType === "soldTransactions"` sur l'observation d'origine) — ce
 * module ne déduit jamais une vente de sa propre initiative, et ne
 * l'efface jamais non plus une fois connue (une vente confirmée reste
 * vraie même si l'annonce redevient "visible" par erreur d'une source).
 */

export interface ListingLifecycleState {
  /** Identifiant stable de l'annonce — typiquement `${source}:${sourceItemId}`, jamais généré ici. */
  listingKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
  observedCount: number;
  currentlySeen: boolean;
  /** `null` tant que l'annonce est vue ou n'a pas encore franchi la règle de disparition. */
  disappearedAt: string | null;
  /** `null` sauf confirmation EXPLICITE d'une source — jamais déduit de `disappearedAt`. */
  confirmedSoldAt: string | null;
}

export interface ListingObservationEvent {
  observedAt: string;
  /** Horodatage de vente confirmé par LA SOURCE elle-même pour CET événement précis — `null`/absent dans l'immense majorité des cas (une annonce active ordinaire), jamais déduit ici. */
  confirmedSoldAt?: string | null;
}

export function initListingLifecycle(listingKey: string, firstEvent: ListingObservationEvent): ListingLifecycleState {
  return {
    listingKey,
    firstSeenAt: firstEvent.observedAt,
    lastSeenAt: firstEvent.observedAt,
    observedCount: 1,
    currentlySeen: true,
    disappearedAt: null,
    confirmedSoldAt: firstEvent.confirmedSoldAt ?? null,
  };
}

/** Une nouvelle observation de la MÊME annonce — la fait redevenir "vue" même si elle avait été marquée disparue entre-temps (une réapparition n'est jamais un mensonge, juste une nouvelle donnée). */
export function recordListingObservation(state: ListingLifecycleState, event: ListingObservationEvent): ListingLifecycleState {
  return {
    ...state,
    lastSeenAt: event.observedAt,
    observedCount: state.observedCount + 1,
    currentlySeen: true,
    disappearedAt: null,
    // Une vente confirmée, une fois connue, n'est jamais effacée par une observation ultérieure qui n'en confirme pas une elle-même.
    confirmedSoldAt: state.confirmedSoldAt ?? event.confirmedSoldAt ?? null,
  };
}

/**
 * Marque une annonce comme non observée DEPUIS `asOf` si elle n'a pas été
 * revue depuis au moins `disappearanceRuleHours` — jamais immédiatement à
 * la première absence d'un seul cycle (une source qui timeout une fois
 * n'implique rien). `disappearedAt` = `lastSeenAt` (le dernier moment où
 * l'annonce était RÉELLEMENT confirmée présente), jamais `asOf` lui-même
 * (qui ne serait qu'un horodatage de vérification, pas de disparition
 * réelle).
 */
export function markListingNotObservedIfDue(state: ListingLifecycleState, asOf: string, disappearanceRuleHours: number): ListingLifecycleState {
  if (!state.currentlySeen) return state; // déjà marquée, jamais retraitée.
  const hoursSinceLastSeen = (Date.parse(asOf) - Date.parse(state.lastSeenAt)) / (1000 * 60 * 60);
  if (hoursSinceLastSeen < disappearanceRuleHours) return state;
  return { ...state, currentlySeen: false, disappearedAt: state.lastSeenAt };
}

export interface ReconcileListingLifecyclesInput {
  previousStates: readonly ListingLifecycleState[];
  /** Événements de CE cycle d'instantané, indexés par `listingKey`. */
  observedThisCycle: ReadonlyMap<string, ListingObservationEvent>;
  asOf: string;
  disappearanceRuleHours: number;
}

/**
 * Réconcilie l'état précédent avec les observations d'un nouveau cycle —
 * point d'entrée unique pour le moteur d'instantanés (section 5) : annonces
 * revues mises à jour, nouvelles annonces initialisées, annonces absentes
 * depuis trop longtemps marquées disparues (jamais vendues). Idempotent :
 * ré-exécuter avec le même `observedThisCycle`/`asOf` produit le même état.
 */
export function reconcileListingLifecycles(input: ReconcileListingLifecyclesInput): ListingLifecycleState[] {
  const previousByKey = new Map(input.previousStates.map((s) => [s.listingKey, s] as const));
  const results: ListingLifecycleState[] = [];
  const handledKeys = new Set<string>();

  for (const [listingKey, event] of input.observedThisCycle) {
    const previous = previousByKey.get(listingKey);
    results.push(previous ? recordListingObservation(previous, event) : initListingLifecycle(listingKey, event));
    handledKeys.add(listingKey);
  }

  for (const previous of input.previousStates) {
    if (handledKeys.has(previous.listingKey)) continue; // déjà traitée ci-dessus (revue ce cycle).
    results.push(markListingNotObservedIfDue(previous, input.asOf, input.disappearanceRuleHours));
  }

  return results;
}
