import type {
  CatalogConnector,
  CatalogMatch,
  CatalogQuery,
  ConnectorDescriptor,
  HealthCheckResult,
  NormalizedPriceObservation,
  PricingConnector,
  PricingQuery,
} from "../types";
import type { ConnectorRegistry } from "./registry";

function isCatalogConnector(connector: ConnectorDescriptor): connector is CatalogConnector {
  return connector.family === "catalog" && typeof (connector as Partial<CatalogConnector>).resolve === "function";
}

function isPricingConnector(connector: ConnectorDescriptor): connector is PricingConnector {
  return connector.family === "pricing" && typeof (connector as Partial<PricingConnector>).lookup === "function";
}

export interface HealthCheckedConnector {
  descriptor: ConnectorDescriptor;
  health: HealthCheckResult;
}

/**
 * Score honnête combinant la qualité déclarée à l'écriture du connecteur et
 * l'état de santé observé au moment de l'appel — jamais une confiance figée.
 * `down` exclut déjà le candidat en amont (voir `rankCandidates`) ; `degraded`
 * réduit fortement le score pour qu'un concurrent moins bien noté mais
 * réellement disponible puisse l'emporter.
 */
export function scoreDescriptor(descriptor: ConnectorDescriptor, health: HealthCheckResult): number {
  const q = descriptor.declaredQuality;
  const declaredAverage = (q.reliability + q.coverage + q.freshness + q.latency + q.confidence) / 5;
  if (health.status === "down") return 0;
  if (health.status === "degraded") return declaredAverage * 0.5;
  return declaredAverage;
}

/**
 * Classe les candidats par score décroissant (qualité déclarée × santé
 * observée) et exclut tout connecteur `down` — jamais appelé, même en
 * dernier recours. Égalité de score : ordre alphabétique de `source`, pour
 * un résultat déterministe et testable, jamais un choix arbitraire.
 */
export function rankCandidates(checked: HealthCheckedConnector[]): ConnectorDescriptor[] {
  return checked
    .filter((c) => c.health.status !== "down")
    .map((c) => ({ descriptor: c.descriptor, score: scoreDescriptor(c.descriptor, c.health) }))
    .sort((a, b) => b.score - a.score || a.descriptor.source.localeCompare(b.descriptor.source))
    .map((c) => c.descriptor);
}

export interface CapabilityEngineOptions {
  /** `false` par défaut : ce moteur sélectionne et invoque, il ne tranche pas seul une politique commerciale. */
  commercialUseRequired?: boolean;
}

/**
 * Moteur de capacités (ADR 0012) — traduit un besoin versionné
 * (`catalog.resolve.v1`, `pricing.lookup.v1`…) en appel au meilleur
 * connecteur compatible parmi ceux enregistrés dans le `ConnectorRegistry`.
 * Aucun nom de connecteur n'apparaît jamais dans ce fichier : la sélection
 * repose uniquement sur `family`, la capacité demandée, la catégorie, la
 * licence et l'état de santé observé. Ne modifie aucune décision
 * BUY/REVIEW/PASS — ne fait que sélectionner et invoquer.
 */
export class CapabilityEngine {
  constructor(private readonly registry: ConnectorRegistry) {}

  private async selectConnector(
    family: "catalog" | "pricing",
    capability: string,
    categorySlug: string,
    options: CapabilityEngineOptions = {},
  ): Promise<ConnectorDescriptor | null> {
    const candidates = this.registry.query({
      family,
      capability,
      categorySlug,
      commercialUseRequired: options.commercialUseRequired ?? false,
    });
    if (candidates.length === 0) return null;

    const checked = await Promise.all(
      candidates.map(async (descriptor): Promise<HealthCheckedConnector> => ({ descriptor, health: await descriptor.healthCheck() })),
    );

    return rankCandidates(checked)[0] ?? null;
  }

  /** Résout `catalog.resolve.v1` (par défaut) via le meilleur Catalog Connector compatible — jamais un nom codé en dur. */
  async resolveCatalog(
    query: CatalogQuery,
    capability = "catalog.resolve.v1",
    options?: CapabilityEngineOptions,
  ): Promise<CatalogMatch[]> {
    const best = await this.selectConnector("catalog", capability, query.categorySlug, options);
    if (!best || !isCatalogConnector(best)) return [];
    return best.resolve(query);
  }

  /** Résout `pricing.lookup.v1` (par défaut) via le meilleur Pricing Connector compatible — jamais un nom codé en dur. */
  async resolvePricing(
    query: PricingQuery,
    capability = "pricing.lookup.v1",
    options?: CapabilityEngineOptions,
  ): Promise<NormalizedPriceObservation[]> {
    const best = await this.selectConnector("pricing", capability, query.categorySlug, options);
    if (!best || !isPricingConnector(best)) return [];
    return best.lookup(query);
  }
}
