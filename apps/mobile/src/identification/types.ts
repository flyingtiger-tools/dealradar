import type { CategorySlug } from "@dealradar/contracts";
import type { UniversalCaptureResult } from "../capture/types";

/**
 * Identité d'un utilisateur authentifié pour appeler le pipeline existant —
 * même paire `accessToken`/`userId` que `TcgScanScreen`/`App.tsx` (LOT 8/9),
 * jamais un second mécanisme d'authentification.
 */
export interface AuthContext {
  accessToken: string;
  userId: string;
}

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
  valuation: {
    low: number | null;
    high: number | null;
    currency: string | null;
  };
  evidence: string[];
  missingInformation: string[];
  risks: string[];
  analysisId: string | null;
}

/**
 * Interface minimale par catégorie — deux méthodes seulement, pas de
 * généralisation prématurée (ADR 0013 : refus du big-bang multi-catégories).
 */
export interface CategoryAdapter {
  readonly category: CategorySlug;
  canHandle(capture: UniversalCaptureResult, categoryHint: CategorySlug | null): IdentificationCandidate;
  /** Ne rejette jamais — toute erreur devient un `RafAnalysis` avec `status: "failed"`, jamais une exception qui remonte à l'appelant. */
  analyze(capture: UniversalCaptureResult, auth: AuthContext): Promise<RafAnalysis>;
}
