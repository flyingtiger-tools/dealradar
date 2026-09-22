/**
 * Politique de rétention (LOT "Product History UX + Source Health +
 * Interactive Cancellation + Beta Readiness", section 11) — voir
 * `docs/retention-policy.md` pour la justification produit/légale complète
 * de chaque durée. Ce module ne fait QUE deux choses, jamais plus :
 * 1. déclarer la politique elle-même (`RETENTION_POLICIES`, une constante
 *    de données, jamais du code exécuté) ;
 * 2. offrir des fonctions PURES qui, à partir de lignes déjà chargées et
 *    d'une date de référence, répondent "lesquelles SERAIENT éligibles à un
 *    nettoyage" — AUCUNE de ces fonctions ne lit ni n'écrit Supabase, et
 *    aucune ne supprime quoi que ce soit. Un futur job de nettoyage
 *    (hors scope de ce lot — "No Production data deletion this lot")
 *    consommerait ces fonctions après avoir lui-même chargé les lignes et
 *    déciderait lui-même s'il exécute une suppression réelle.
 *
 * Absent volontairement : `market_observations` (aucune politique de
 * suppression proposée ici — c'est la donnée produit centrale de
 * l'historique de prix, voir `docs/retention-policy.md` section
 * "Rétention illimitée").
 */

export type RetentionTable =
  | "market_refresh_runs"
  | "market_refresh_run_targets"
  | "listing_lifecycles"
  | "market_snapshot_summaries"
  | "cancelled_analysis_requests";

export interface RetentionPolicy {
  table: RetentionTable;
  /** Colonne timestamp (ISO 8601) utilisée comme référence d'âge — jamais `created_at` seul si une colonne plus tardive existe (voir chaque entrée). */
  timestampColumn: string;
  retentionDays: number;
  /** Justification courte — la version complète vit dans `docs/retention-policy.md`, jamais dupliquée en détail ici. */
  rationale: string;
}

/**
 * Durées choisies pour distinguer deux familles bien différentes :
 * - Logs OPÉRATIONNELS bruyants (runs de rafraîchissement) : courte durée
 *   (90 jours), aucune valeur produit au-delà d'un audit récent.
 * - Données avec une valeur d'AUDITABILITÉ/produit plus longue (cycles de
 *   marché déjà résumés, cycle de vie des annonces) : rétention nettement
 *   plus longue (365-730 jours), jamais aussi courte qu'un simple log.
 * - Requêtes d'analyse ANNULÉES : très courte (30 jours) — aucune valeur
 *   produit une fois annulées (voir migration 0026, `status = 'cancelled'`),
 *   et elles référencent des images utilisateur uploadées qui devraient
 *   elles aussi être nettoyées à terme (hors scope de ce module).
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    table: "market_refresh_runs",
    timestampColumn: "created_at",
    retentionDays: 90,
    rationale: "Audit opérationnel du rafraîchissement en arrière-plan (LOT 'Close the Refresh Loop') — utile pour diagnostiquer un incident récent, sans valeur produit au-delà de 90 jours.",
  },
  {
    table: "market_refresh_run_targets",
    timestampColumn: "created_at",
    retentionDays: 90,
    rationale: "Détail par cible d'un run (voir market_refresh_runs) — même durée que son parent, supprimé en cascade (on delete cascade, migration 0024) si le run parent est nettoyé en premier.",
  },
  {
    table: "listing_lifecycles",
    timestampColumn: "last_seen_at",
    retentionDays: 365,
    rationale: "Trace de détection de vente (disparition d'annonce -> confirmed_sold_at) — nécessaire à l'auditabilité de toute vente confirmée déjà persistée ailleurs (market_observations) ; 1 an couvre largement le délai de tout litige/vérification raisonnable.",
  },
  {
    table: "market_snapshot_summaries",
    timestampColumn: "cycle_at",
    retentionDays: 730,
    rationale: "Alimente directement le graphique d'historique de prix (ProductHistoryScreen, `recentSnapshotSummaries`) — donnée PRODUIT, jamais traitée comme un simple log ; 2 ans avant même d'envisager un nettoyage, largement au-delà de l'horizon de tendance affiché (180 jours max).",
  },
  {
    table: "cancelled_analysis_requests",
    timestampColumn: "updated_at",
    retentionDays: 30,
    rationale: "Requête d'analyse ANNULÉE (status = 'cancelled', migration 0026) — aucune valeur produit après annulation, contrairement à une requête complétée (jamais couverte par cette politique). Voir `selectCancelledAnalysisRequestsEligibleForCleanup` : ne sélectionne QUE status = 'cancelled', jamais une requête complétée/en échec.",
  },
];

/** Une ligne minimale porteuse d'une colonne timestamp — jamais typée plus précisément pour rester réutilisable par n'importe quelle table de la politique. */
export type RetentionCandidateRow = Record<string, unknown>;

function parseTimestampColumn(row: RetentionCandidateRow, column: string): number | null {
  const value = row[column];
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fonction PURE générique : à partir de lignes déjà chargées, retourne
 * celles dont `policy.timestampColumn` est antérieure à `asOf - retentionDays`.
 * Une ligne dont la colonne timestamp est absente/invalide n'est JAMAIS
 * considérée éligible (repli sûr — mieux vaut conserver une ligne
 * ambiguë que supprimer par erreur une ligne dont l'âge n'a pas pu être
 * établi).
 */
export function selectRowsEligibleForCleanup<T extends RetentionCandidateRow>(rows: readonly T[], policy: RetentionPolicy, asOf: Date): T[] {
  const cutoffMs = asOf.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    const ts = parseTimestampColumn(row, policy.timestampColumn);
    return ts !== null && ts < cutoffMs;
  });
}

/**
 * Spécialisation pour `analysis_requests` — ne sélectionne QUE les lignes
 * `status === "cancelled"` (jamais `"completed"`/`"failed"`/`"insufficient_data"`,
 * qui n'ont AUCUNE politique de rétention dans ce lot) ET assez anciennes
 * selon `RETENTION_POLICIES` (`cancelled_analysis_requests`). Séparée de
 * `selectRowsEligibleForCleanup` car le filtre par statut n'a pas de sens
 * pour les autres tables de la politique (aucune n'a de colonne `status`
 * comparable).
 */
export function selectCancelledAnalysisRequestsEligibleForCleanup<T extends RetentionCandidateRow & { status: unknown }>(
  rows: readonly T[],
  asOf: Date,
): T[] {
  const policy = RETENTION_POLICIES.find((p) => p.table === "cancelled_analysis_requests");
  if (!policy) throw new Error("Politique de rétention 'cancelled_analysis_requests' introuvable — RETENTION_POLICIES a été modifié de façon incohérente.");
  const cancelledOnly = rows.filter((row) => row.status === "cancelled");
  return selectRowsEligibleForCleanup(cancelledOnly, policy, asOf);
}
