import {
  SOURCE_READINESS_MATRIX,
  resolveSourceReadiness,
  preferredSourceNamesForCategory,
  type ActivationStatus,
  type SourceCostClass,
  type SourceHealthLevel,
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
  /** `"healthy"` par défaut si `sourceHealth` n'a rien pour cette source (jamais devinée mauvaise en l'absence de donnée) — voir `BuildSourceSelectionPlanInput.sourceHealth`. */
  healthState: SourceHealthLevel;
  /** `true` UNIQUEMENT si cette source a été repositionnée PLUS TARD dans l'ordre de sélection à cause de sa santé (jamais une exclusion — voir `SourceSelectionPlan.deprioritizedForHealth`). */
  deprioritizedForHealth: boolean;
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
  /**
   * Sources `"degraded"`/`"unhealthy"` (LOT "Product History UX + Source
   * Health + Interactive Cancellation + Beta Readiness", section 5) qui ont
   * été REPOSITIONNÉES plus tard dans `selectionOrder` à cause de leur
   * santé — jamais exclues pour ce seul motif ("do NOT permanently disable
   * a source from one failure"). Un sous-ensemble de `selectedSources`
   * (une source non retenue pour une AUTRE raison — politique/credentials/
   * budget — n'apparaît jamais ici, voir `excludedBy*` pour ces cas).
   */
  deprioritizedForHealth: string[];
}

export interface BuildSourceSelectionPlanInput {
  categorySlug: string;
  /** Présence des variables d'environnement requises PAR SOURCE — jamais lue depuis `process.env` ici (voir `source-readiness-matrix.ts`). */
  envPresenceBySource: Record<string, Record<string, boolean>>;
  /** `null` si l'identité canonique n'est pas encore connue — dans ce cas, aucune source n'est exclue pour faiblesse d'identité (on ne peut juger une exactitude qu'on ne connaît pas encore). */
  identityHealth: IdentityHealthSummary | null;
  budgetState: RefreshBudgetState;
  budgetLimits: RefreshBudgetLimits;
  /**
   * Santé PAR SOURCE déjà calculée par l'appelant (LOT "Product History UX
   * + Source Health + Interactive Cancellation + Beta Readiness", section
   * 5) — fonction PURE, ne lit/n'écrit JAMAIS cet état elle-même (voir
   * `packages/ingestion/src/source-health.ts` pour le chargement/la
   * persistance réels). Absent/source non répertoriée = `"healthy"` par
   * défaut, jamais devinée mauvaise. Un signal SECONDAIRE uniquement : la
   * pertinence de catégorie/préparation/exactitude d'identité restent
   * évaluées AVANT (jamais une source exclue pour sa seule santé).
   */
  sourceHealth?: Record<string, SourceHealthLevel>;
}

function exactnessRank(source: string, identityHealth: IdentityHealthSummary | null): number {
  if (!identityHealth) return 1;
  if (identityHealth.exactSearchableSources.includes(source)) return 0;
  if (identityHealth.fallbackOnlySources.includes(source)) return 1;
  return 1; // ni exact ni repli connu (ex. hors profils de requête connus) -> neutre, jamais pénalisé arbitrairement.
}

const HEALTH_RANK: Record<SourceHealthLevel, number> = { healthy: 0, degraded: 1, unhealthy: 2 };

export function buildSourceSelectionPlan(input: BuildSourceSelectionPlanInput): SourceSelectionPlan {
  const candidateDescriptors = SOURCE_READINESS_MATRIX.filter(
    (d) => MARKET_SOURCE_NAMES.includes(d.source) && (d.categoryCoverage === "any" || d.categoryCoverage.includes(input.categorySlug)),
  );

  const preferred = preferredSourceNamesForCategory(input.categorySlug);
  const preferredIndex = new Map(preferred.map((name, i) => [name, i] as const));

  const healthStateFor = (source: string): SourceHealthLevel => input.sourceHealth?.[source] ?? "healthy";

  // Départage déterministe : exactitude d'identifiant d'abord (exact avant
  // repli), PUIS santé (secondaire — section 5 : "category relevance /
  // readiness / exact identity still come first"), PUIS préférence de
  // catégorie (tie-break stable) — tri STABLE pour ne jamais réordonner
  // arbitrairement deux sources à égalité sur les trois critères.
  const orderedDescriptors = [...candidateDescriptors].sort((a, b) => {
    const exactnessDiff = exactnessRank(a.source, input.identityHealth) - exactnessRank(b.source, input.identityHealth);
    if (exactnessDiff !== 0) return exactnessDiff;
    const healthDiff = HEALTH_RANK[healthStateFor(a.source)] - HEALTH_RANK[healthStateFor(b.source)];
    if (healthDiff !== 0) return healthDiff;
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
  const deprioritizedForHealth: string[] = [];
  const projectedCostClasses: Record<string, SourceCostClass> = {};
  let state = input.budgetState;

  for (const descriptor of orderedDescriptors) {
    const name = descriptor.source;
    projectedCostClasses[name] = descriptor.costClass;
    const envPresence = input.envPresenceBySource[name] ?? {};
    const readiness = resolveSourceReadiness(descriptor, envPresence);
    const healthState = healthStateFor(name);

    if (readiness === "restricted" || readiness === "disabled_policy" || readiness === "license_required" || !descriptor.productionAllowed) {
      excludedByPolicy.push(name);
      entries.push({ source: name, costClass: descriptor.costClass, readiness, included: false, reason: `Verrouillé par politique ("${readiness}").`, healthState, deprioritizedForHealth: false });
      continue;
    }
    if (readiness === "missing_credentials") {
      excludedByMissingCredentials.push(name);
      entries.push({ source: name, costClass: descriptor.costClass, readiness, included: false, reason: "Credentials manquantes.", healthState, deprioritizedForHealth: false });
      continue;
    }

    if (input.identityHealth?.blockedSourcesDueToIdentity.includes(name)) {
      excludedByIdentityWeakness.push(name);
      entries.push({ source: name, costClass: descriptor.costClass, readiness, included: false, reason: "Identité insuffisante ou conflit non résolu pour cette source — aucun plan de requête exploitable.", healthState, deprioritizedForHealth: false });
      continue;
    }

    eligibleSources.push(name);
    const budgetCheck = canQuerySource(state, input.budgetLimits, descriptor.costClass);
    if (!budgetCheck.allowed) {
      excludedByCostBudget.push(name);
      // Un budget épuisé alors qu'une source dégradée/malsaine a été
      // repositionnée plus tard dans l'ordre peut être LA raison réelle
      // pour laquelle elle est coupée ici — signal informatif, jamais une
      // seconde exclusion pour la santé seule (le budget reste la cause).
      entries.push({
        source: name,
        costClass: descriptor.costClass,
        readiness,
        included: false,
        reason: healthState !== "healthy" ? `${budgetCheck.reason ?? "Budget épuisé."} (repositionnée plus tard pour santé "${healthState}", coupée par le budget avant d'être atteinte).` : (budgetCheck.reason ?? "Budget épuisé."),
        healthState,
        deprioritizedForHealth: false,
      });
      continue;
    }

    const deprioritized = healthState !== "healthy";
    if (deprioritized) deprioritizedForHealth.push(name);
    selectedSources.push(name);
    entries.push({
      source: name,
      costClass: descriptor.costClass,
      readiness,
      included: true,
      reason: deprioritized ? `Sélectionné (santé "${healthState}" — repositionnée plus tard dans l'ordre, jamais exclue pour ce seul motif).` : "Sélectionné.",
      healthState,
      deprioritizedForHealth: deprioritized,
    });
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
    deprioritizedForHealth,
  };
}
