/**
 * Abstraction générique de fournisseur de scraping (LOT "Multi-Source
 * Market Intelligence Foundation") — DealRadar ne dépend JAMAIS
 * directement de Zyte/Bright Data/Apify/Oxylabs : tout code métier
 * n'appelle que `ScrapingProvider`, jamais le SDK d'un vendeur précis.
 * Aucune logique de contournement anti-bot n'est implémentée ICI ni
 * ailleurs dans DealRadar (règle absolue du lot) — cette interface
 * suppose que le vendeur gère ça de son côté ; DealRadar ne fait que
 * consommer un résultat structuré déjà obtenu légalement.
 *
 * Distinct de `../web/types.ts` (`WebMarketplaceFetcher`) : ce dernier est
 * un contrat plus étroit, déjà préparé pour un futur scraper "maison"
 * (Ricardo/Anibis, jamais câblé), qui retourne du HTML brut sans
 * extraction structurée ni rendu JS ni métadonnées de coût. Celui-ci est
 * délibérément plus riche (rendu JS optionnel, extraction structurée,
 * diagnostics de coût) pour représenter honnêtement ce qu'un vendeur de
 * scraping géré (Zyte/Bright Data/Apify) expose réellement — les deux
 * coexistent, aucun des deux ne remplace l'autre ce lot.
 */

export interface ScrapeRequest {
  url: string;
  /** `true` si la page nécessite un rendu JavaScript (ex. contenu chargé en client-side) — coûte généralement plus cher chez la plupart des vendeurs, jamais activé par défaut. */
  renderJs?: boolean;
  /** Code pays ISO 3166-1 alpha-2 si le vendeur supporte le géociblage (ex. proxy résidentiel localisé) — `undefined` = comportement par défaut du vendeur. */
  country?: string;
  timeoutMs?: number;
}

export type ScrapeFailureReason = "timeout" | "blocked" | "not_found" | "provider_error" | "invalid_request";

export class ScrapeError extends Error {
  readonly reason: ScrapeFailureReason;
  readonly retryable: boolean;

  constructor(message: string, options: { reason: ScrapeFailureReason; retryable?: boolean }) {
    super(message);
    this.name = "ScrapeError";
    this.reason = options.reason;
    this.retryable = options.retryable ?? false;
  }
}

/** Diagnostics/coût du fournisseur pour CET appel — jamais un total cumulé (voir `source-health-tracker.ts` pour l'agrégation dans le temps, une responsabilité distincte). */
export interface ScrapeDiagnostics {
  provider: string;
  latencyMs: number;
  /** `null` si le vendeur n'expose pas assez d'information pour estimer un coût par requête — jamais une valeur inventée. */
  estimatedCostUsd: number | null;
  /** `true` si le rendu JS a réellement été utilisé pour CET appel (peut différer de la demande si le vendeur applique son propre repli). */
  usedJsRendering: boolean;
  httpStatus: number | null;
}

/**
 * Résultat structuré — volontairement un bag de champs extraits plutôt que
 * du HTML brut (contrairement à `WebFetchResult`) : chaque vendeur
 * d'extraction structurée (Zyte Automatic Extraction, Bright Data Web
 * Unlocker + parsing, Apify actors) a son propre schéma de sortie ; ce
 * type ne prescrit QUE ce qui est commun et sûr — l'implémentation
 * concrète est responsable de mapper la réponse de son vendeur vers cette
 * forme, jamais l'inverse.
 */
export interface ScrapeResult {
  url: string;
  fetchedAt: string;
  /** HTML brut UNIQUEMENT si le vendeur le restitue et que l'appelant en a explicitement besoin (ex. pour un `normalize.ts` dédié) — `null` sinon, jamais retenu par défaut (coût de stockage/traçabilité). */
  rawHtml: string | null;
  /** Champs extraits par le vendeur (titre/prix/etc.) si une extraction structurée a été demandée/fournie — bag ouvert, jamais une forme figée (chaque vendeur/page a son propre schéma). */
  extractedFields: Record<string, unknown>;
  diagnostics: ScrapeDiagnostics;
}

/**
 * Contrat unique consommé par tout code métier DealRadar. Une implémentation
 * concrète par vendeur (ex. `createZyteScrapingProvider`, non construite ce
 * lot faute de credentials — voir le mock ci-dessous et
 * `docs/market-intelligence-sources.md`) traduit ce contrat vers l'API du
 * vendeur ; jamais l'inverse.
 */
export interface ScrapingProvider {
  readonly name: string;
  scrape(request: ScrapeRequest): Promise<ScrapeResult>;
}

/**
 * Implémentation de test — jamais un appel réseau réel, même discipline
 * que `web/mock-fetcher.ts`. Permet de tester tout code qui dépend de
 * `ScrapingProvider` sans vendeur configuré.
 */
export function createMockScrapingProvider(responses: Record<string, ScrapeResult | ScrapeError>): ScrapingProvider {
  return {
    name: "mock",
    async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
      const outcome = responses[request.url];
      if (!outcome) {
        throw new ScrapeError(`Aucune réponse simulée configurée pour ${request.url}`, { reason: "not_found" });
      }
      if (outcome instanceof ScrapeError) throw outcome;
      return outcome;
    },
  };
}
