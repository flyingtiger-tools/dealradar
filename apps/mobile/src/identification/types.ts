import type { CategorySlug, MarketEvidence, IdentityQuality } from "@dealradar/contracts";
import type { UniversalCaptureResult } from "../capture/types";

/**
 * Jugement d'un `CategoryAdapter` sur sa capacité à traiter une capture
 * donnée — `category: null` signifie "je ne sais pas", jamais une
 * catégorie devinée sans preuve (ADR 0013 : le moteur V1 est honnête,
 * il ne prétend jamais reconnaître automatiquement toutes les catégories).
 */
export interface IdentificationCandidate {
  category: CategorySlug | null;
  /** 0 = aucune preuve, 1 = route explicite (ex. onglet bêta dédié à cette catégorie). */
  confidence: number;
  evidence: string[];
  missingFields: string[];
}

export type RafAnalysisStatus = "identified" | "needs_confirmation" | "insufficient_data" | "failed";

/**
 * Étapes réseau réelles traversées par `CategoryAdapter.analyze()` — jamais
 * une progression fabriquée par un minuteur : l'écran appelant ne reçoit un
 * changement de phase que lorsque l'adaptateur franchit réellement cette
 * étape (voir `tcg-adapter.ts`).
 */
export type AnalysisProgressPhase = "uploading" | "submitting" | "polling";
/**
 * `analysisId` (LOT "Product History UX + Source Health + Interactive
 * Cancellation + Beta Readiness", section 6/7) — transmis UNIQUEMENT à
 * partir du passage en phase `"polling"` (c'est le premier instant où la
 * ligne `analysis_requests` existe côté serveur, voir `createAnalysis()`) :
 * `undefined` pour `"uploading"`/`"submitting"`. Permet à l'écran appelant
 * de capturer l'identifiant nécessaire à `cancelAnalysis()` dès qu'il
 * existe, sans attendre la résolution finale de `analyze()`.
 */
export type OnAnalysisProgress = (phase: AnalysisProgressPhase, analysisId?: string) => void;

/**
 * Contrat générique minimal consommé par l'écran de résultat bêta —
 * volontairement pas le contrat commercial final (pas de revente, pas
 * d'offres alternatives, pas de recommandation de plateforme). Reflète
 * `TcgCardAnalysisResult`/`AnalysisResult` (`@dealradar/contracts`) sans les
 * importer telles quelles, exactement la même discipline de séparation déjà
 * en vigueur entre `@dealradar/contracts` et `@dealradar/core`.
 */
export interface RafAnalysis {
  category: CategorySlug | null;
  status: RafAnalysisStatus;
  product: {
    name: string | null;
    setName: string | null;
    collectorNumber: string | null;
    language: string | null;
  };
  /** `null` si aucune extraction n'a pu produire de score — jamais 0 par défaut (voir ADR 0012/correctif `confidence` nullable). */
  confidence: number | null;
  /** `null` pour la verticale TCG (LOT 8) — ce flux n'exprime aucune décision BUY/REVIEW/PASS, seulement une identité + des observations de prix. */
  decision: string | null;
  /** `null` pour la verticale TCG (aucun `dealScore` produit par ce flux) — présent pour les catégories génériques (LOT "rendre le scan universel accessible", `generic-object-adapter.ts`), jamais recalculé ici : reporte tel quel `AnalysisResult.dealScore` déjà produit par `runIntelligencePipeline()` côté serveur. */
  dealScore: number | null;
  valuation: {
    low: number | null;
    high: number | null;
    currency: string | null;
  };
  evidence: string[];
  missingInformation: string[];
  risks: string[];
  analysisId: string | null;
  /**
   * Clé produit canonique + preuve de marché DÉJÀ RÉSOLUES côté serveur
   * (LOT "Product History UX + Source Health + Interactive Cancellation +
   * Beta Readiness", section 1/2) — reportées TELLES QUELLES depuis
   * `AnalysisResult.productKey`/`marketEvidence` par `generic-object-
   * adapter.ts` (`fromGenericAnalysisResult`), JAMAIS recalculées ici.
   * Optionnelles pour ne casser AUCUN constructeur existant de
   * `RafAnalysis` (`raf-analysis-helpers.ts`, `tcg-adapter.ts`, fixtures de
   * test) — `undefined`/`null` pour tout flux qui n'en produit pas (TCG,
   * échec, données insuffisantes). Voir `screens/result/market-insight.ts`
   * pour la traduction en `ResultMarketInsight`.
   */
  productKey?: string | null;
  marketEvidence?: MarketEvidence;
  /**
   * Reporté TEL QUEL depuis `AnalysisResult.identityQuality` (LOT "Live
   * Identity Enrichment + Barcode-First + upc.dev Fallback + Railway
   * Readiness", section 12) par `generic-object-adapter.ts` — même
   * discipline que `productKey`/`marketEvidence` ci-dessus, optionnel pour
   * ne casser aucun constructeur existant. Voir `screens/result/identity-
   * quality.ts` pour la traduction en libellé d'affichage.
   */
  identityQuality?: IdentityQuality;
}

/**
 * Interface minimale par catégorie — deux méthodes seulement, pas de
 * généralisation prématurée (ADR 0013 : refus du big-bang multi-catégories).
 */
export interface CategoryAdapter {
  readonly category: CategorySlug;
  canHandle(capture: UniversalCaptureResult, categoryHint: CategorySlug | null): IdentificationCandidate;
  /**
   * Ne rejette jamais — toute erreur devient un `RafAnalysis` avec
   * `status: "failed"`, jamais une exception qui remonte à l'appelant.
   * Aucun paramètre d'authentification : l'implémentation appelle des
   * fonctions qui tirent elles-mêmes le jeton/l'identifiant de la session
   * Supabase courante (`auth/session.ts`), jamais une seconde voie.
   *
   * `signal` (LOT "Product History UX...", section 6/7) — optionnel,
   * purement CLIENT (contrôle uniquement `pollAnalysisUntilSettled`, jamais
   * transmis au serveur). Un adaptateur qui n'a pas de boucle de polling
   * interruptible (ex. chemin serverless synchrone TCG) peut l'ignorer sans
   * violer le contrat.
   */
  analyze(capture: UniversalCaptureResult, onProgress?: OnAnalysisProgress, signal?: AbortSignal): Promise<RafAnalysis>;
}
