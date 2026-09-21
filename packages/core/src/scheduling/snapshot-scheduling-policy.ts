/**
 * Politique de planification des instantanés de marché (LOT "Historical
 * Data Engine", section 6) — fonction PURE, ne déploie AUCUN scheduler ni
 * tâche planifiée (interdiction explicite du lot) : produit seulement une
 * DÉCISION (`nextRefreshAt`/`priority`) que l'appelant (un futur job
 * `apps/workers`, jamais construit ce lot) pourrait consommer.
 *
 * `CostClass` dupliqué localement (mêmes valeurs que `SourceCostClass`,
 * `@dealradar/connectors/market-intelligence/source-routing.ts`) plutôt
 * qu'importé — `packages/core` n'a et n'aura jamais de dépendance à
 * `@dealradar/connectors` (même discipline que `fuse-market-observations.
 * ts`/`history-signals.ts`, voir leurs en-têtes).
 */
export type CostClass = "free" | "cheap" | "paid" | "high_cost";

/** Plancher de fréquence par classe de coût — "never schedule faster than provider budget/rate constraints" (instruction explicite du lot), jamais dépassé même pour un produit très actif. */
const COST_CLASS_MIN_INTERVAL_HOURS: Record<CostClass, number> = {
  free: 1,
  cheap: 4,
  paid: 12,
  high_cost: 48,
};

/** Coefficient de variation (voir `computeVolatility`, `history-signals.ts`) au-delà duquel un prix est jugé volatil. */
const VOLATILE_CV_THRESHOLD = 0.15;

export interface SnapshotSchedulingInput {
  asOf: string;
  /** `null` = jamais rafraîchi — éligible immédiatement, priorité maximale. */
  lastRefreshedAt: string | null;
  /** `null` si inconnu/historique insuffisant pour le calculer — jamais une volatilité inventée. */
  priceVolatility: number | null;
  /** Le produit a été scanné/consulté/ajouté en watchlist récemment (scan utilisateur, forte activité). */
  recentActivity: boolean;
  /** Classe de coût de la source LA PLUS CHÈRE nécessaire à ce rafraîchissement — impose un plancher de fréquence, jamais un plafond de dépense réel (aucun système de facturation ici). */
  costClass: CostClass;
}

export interface SnapshotSchedulingDecision {
  nextRefreshAt: string;
  /** 0–100, plus haut = plus urgent. */
  priority: number;
  reason: string;
}

export function decideNextSnapshotRefresh(input: SnapshotSchedulingInput): SnapshotSchedulingDecision {
  if (!input.lastRefreshedAt) {
    return { nextRefreshAt: input.asOf, priority: 100, reason: "Jamais rafraîchi — éligible immédiatement, priorité maximale." };
  }

  const isVolatile = input.priceVolatility !== null && input.priceVolatility >= VOLATILE_CV_THRESHOLD;

  let baseHours: number;
  let priority: number;
  let reason: string;
  if (input.recentActivity && isVolatile) {
    baseHours = 6;
    priority = 90;
    reason = "Activité récente et prix volatil — rafraîchissement très fréquent.";
  } else if (input.recentActivity) {
    baseHours = 12;
    priority = 75;
    reason = "Activité récente (scan/watchlist) — rafraîchissement fréquent.";
  } else if (isVolatile) {
    baseHours = 24;
    priority = 60;
    reason = "Prix volatil — rafraîchissement plus fréquent que la base.";
  } else {
    baseHours = 168; // 7 jours
    priority = 20;
    reason = "Produit stable, sans activité récente — rafraîchissement peu fréquent.";
  }

  const floorHours = COST_CLASS_MIN_INTERVAL_HOURS[input.costClass];
  const effectiveHours = Math.max(baseHours, floorHours);
  if (effectiveHours > baseHours) {
    reason += ` Plancher relevé à ${effectiveHours}h par contrainte de budget/débit de la source (classe "${input.costClass}").`;
  }

  const scheduledAt = new Date(Date.parse(input.lastRefreshedAt) + effectiveHours * 60 * 60 * 1000).toISOString();
  const isPastDue = Date.parse(scheduledAt) <= Date.parse(input.asOf);

  return {
    nextRefreshAt: isPastDue ? input.asOf : scheduledAt,
    priority: isPastDue ? Math.min(100, priority + 10) : priority, // un produit déjà en retard sur son propre calendrier gagne en urgence, jamais silencieusement ignoré.
    reason: isPastDue ? `${reason} Déjà en retard sur son propre calendrier — éligible maintenant.` : reason,
  };
}
