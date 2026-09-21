import {
  SOURCE_READINESS_MATRIX,
  resolveSourceReadiness,
  preferredSourceNamesForCategory,
  type ActivationStatus,
  type SourceCostClass,
} from "@dealradar/connectors";
import {
  canQuerySource,
  recordSourceQueried,
  type RefreshBudgetState,
  type RefreshBudgetLimits,
  type IdentityHealthSummary,
} from "@dealradar/core";

/**
 * Plan de sélection de sources EXPLICITE (LOT "Real DB Integration + Exact
 * Budget Enforcement + Runtime Observability", sections 3/4) — remplace la
 * sélection "interroger puis comptabiliser après coup" par une décision
 * PRISE AVANT toute requête réseau. Fonction PURE : ne lit jamais
 * `process.env` elle-même (voir `envPresenceBySource`, fourni par
 * l'appelant — même discipline que `source-readiness-matrix.ts`).
 *
 * UNE SEULE définition de plan pour les deux chemins consommateurs
 * (analyse interactive ET rafraîchissement en arrière-plan) — voir
 * `docs/market-data-activation-checklist.md` pour la confirmation qu'
 * aucune différence cachée n'existe entre les deux (exigence explicite du
 * lot, section 4).
 *
 * Ordre d'évaluation (règles de sélection du lot, section 3) :
 *  1. pertinence de catégorie (univers réduit à `MARKET_SOURCE_NAMES` ∩
 *     couverture catégorie de la matrice) ;
 *  2. préparation/politique (`resolveSourceReadiness`) ;
 *  3. exactitude d'identifiant/requête (réordonnancement : les sources
 *     `exactSearchable` d'abord, `fallbackOnly` ensuite, jamais un
 *     blocage dur ici — seul `blockedSourcesDueToIdentity` bloque) ;
 *  4. classe de coût ;
 *  5. limites configurées (`RefreshBudgetLimits`, appliquées via les
 *     MÊMES primitives pures que le runner de rafraîchissement,
 *     `canQuerySource`/`recordSourceQueried`) ;
 *  6. départage déterministe : l'ordre de préférence de catégorie
 *     (`CATEGORY_SOURCE_PREFERENCES`) sert de tie-break stable.
 */

/**
 * Univers des sources RÉELLEMENT constructibles par
 * `buildMarketSourcesFromEnv` (`apps/workers/src/ingestion/market-source-
 * factory.ts`) — zyte (fournisseur de scraping générique, jamais une
 * `MarketSource` interrogeable directement) et frankfurter (fournisseur FX)
 * sont volontairement EXCLUS. Toute nouvelle source ajoutée à la fabrique
 * DOIT être ajoutée ici — voir le test de cohérence de la matrice de
 * préparation (section 10 du lot) qui vérifie cette liste contre la
 * fabrique réelle.
 */
export const MARKET_SOURCE_NAMES: readonly string[] = ["ebay", "google_shopping", "dataforseo_google_shopping", "bricklink", "pricecharting", "keepa", "ricardo"];

export interface SourceSelectionEntry {
  source: string;
  costClass: SourceCostClass;
  readiness: ActivationStatus;
  included: boolean;
  reason: string;
}

export interface SourceSelectionPlan {
  categorySlug: string;
  /** Sources qui auraient pu être interrogées (prêtes, catégorie pertinente, identité non bloquante) — AVANT application du budget. */
  eligibleSources: string[];
  excludedByPolicy: string[];
  excludedByMissingCredentials: string[];
  excludedByIdentityWeakness: string[];
  excludedByCostBudget: string[];
  /** Sources RETENUES, dans l'ordre où elles seront interrogées. */
  selectedSources: string[];
  /** Identique à `selectedSources` — nom explicite exigé par le lot (section 4). */
  selectionOrder: string[];
  /** Détail complet, une entrée par source candidate, dans l'ordre d'évaluation. */
  entries: SourceSelectionEntry[];
  projectedCostClasses: Record<string, SourceCostClass>;
  /** État de budget APRÈS avoir comptabilisé la sélection — l'appelant l'utilise comme état de départ pour la cible/le run suivant. */
  budgetStateAfter: RefreshBudgetState;
}

export interface BuildSourceSelectionPlanInput {
  categorySlug: string;
  /** Présence des variables d'environnement requises PAR SOURCE — jamais lue depuis `process.env` ici (voir `source-readiness-matrix.ts`). */
  envPresenceBySource: Record<string, Record<string, boolean>>;
  /** `null` si l'identité canonique n'est pas encore connue — dans ce cas, aucune source n'est exclue pour faiblesse d'identité (on ne peut juger une exactitude qu'on ne connaît pas encore). */
  identityHealth: IdentityHealthSummary | null;
  budgetState: RefreshBudgetState;
  budgetLimits: RefreshBudgetLimits;
}

function exactnessRank(source: string, identityHealth: IdentityHealthSummary | null): number {
  if (!identityHealth) return 1;
  if (identityHealth.exactSearchableSources.includes(source)) return 0;
  if (identityHealth.fallbackOnlySources.includes(source)) return 1;
  return 1; // ni exact ni repli connu (ex. hors profils de requête connus) -> neutre, jamais pénalisé arbitrairement.
}

export function buildSourceSelectionPlan(input: BuildSourceSelectionPlanInput): SourceSelectionPlan {
  const candidateDescriptors = SOURCE_READINESS_MATRIX.filter(
    (d) => MARKET_SOURCE_NAMES.includes(d.source) && (d.categoryCoverage === "any" || d.categoryCoverage.includes(input.categorySlug)),
  );

  const preferred = preferredSourceNamesForCategory(input.categorySlug);
  const preferredIndex = new Map(preferred.map((name, i) => [name, i] as const));

  // Départage déterministe : préférence de catégorie d'abord (tie-break stable), puis exactitude d'identifiant (exact avant repli), en gardant un tri STABLE pour ne jamais réordonner arbitrairement deux sources à égalité.
  const orderedDescriptors = [...candidateDescriptors].sort((a, b) => {
    const exactnessDiff = exactnessRank(a.source, input.identityHealth) - exactnessRank(b.source, input.identityHealth);
    if (exactnessDiff !== 0) return exactnessDiff;
    const prefA = preferredIndex.get(a.source) ?? Number.MAX_SAFE_INTEGER;
    const prefB = preferredIndex.get(b.source) ?? Number.MAX_SAFE_INTEGER;
    return prefA - prefB;
  });

  const entries: SourceSelectionEntry[] = [];
  const eligibleSources: string[] = [];
  const excludedByPolicy: string[] = [];
  const excludedByMissingCredentials: string[] = [];
  const excludedByIdentityWeakness: string[] = [];
  const excludedByCostBudget: string[] = [];
  const selectedSources: string[] = [];
  const projectedCostClasses: Record<string, SourceCostClass> = {};
  let state = input.budgetState;

  for (const descriptor of orderedDescriptors) {
    const name = descriptor.source;
    projectedCostClasses[name] = descriptor.costClass;
    const envPresence = input.envPresenceBySource[name] ?? {};
    const readiness = resolveSourceReadiness(descriptor, envPresence);

    if (readiness === "restricted" || readiness === "disabled_policy" || readiness === "license_required" || !descriptor.productionAllowed) {
      excludedByPolicy.push(name);
      entries.push({ source: name, costClass: descriptor.costClass, readiness, included: false, reason: `Verrouillé par politique ("${readiness}").` });
      continue;
    }
    if (readiness === "missing_credentials") {
      excludedByMissingCredentials.push(name);
      entries.push({ source: name, costClass: descriptor.costClass, readiness, included: false, reason: "Credentials manquantes." });
      continue;
    }

    if (input.identityHealth?.blockedSourcesDueToIdentity.includes(name)) {
      excludedByIdentityWeakness.push(name);
      entries.push({ source: name, costClass: descriptor.costClass, readiness, included: false, reason: "Identité insuffisante ou conflit non résolu pour cette source — aucun plan de requête exploitable." });
      continue;
    }

    eligibleSources.push(name);
    const budgetCheck = canQuerySource(state, input.budgetLimits, descriptor.costClass);
    if (!budgetCheck.allowed) {
      excludedByCostBudget.push(name);
      entries.push({ source: name, costClass: descriptor.costClass, readiness, included: false, reason: budgetCheck.reason ?? "Budget épuisé." });
      continue;
    }

    selectedSources.push(name);
    entries.push({ source: name, costClass: descriptor.costClass, readiness, included: true, reason: "Sélectionné." });
    state = recordSourceQueried(state, descriptor.costClass);
  }

  return {
    categorySlug: input.categorySlug,
    eligibleSources,
    excludedByPolicy,
    excludedByMissingCredentials,
    excludedByIdentityWeakness,
    excludedByCostBudget,
    selectedSources,
    selectionOrder: selectedSources,
    entries,
    projectedCostClasses,
    budgetStateAfter: state,
  };
}
