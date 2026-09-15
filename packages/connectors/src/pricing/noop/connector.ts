import type { ConnectorDescriptor, HealthCheckResult, NormalizedPriceObservation, PricingConnector, PricingQuery } from "../../types";

/**
 * Connecteur pricing "aucune source" — retourne toujours `[]`, jamais une
 * erreur ni une observation inventée. Existe pour que le pipeline TCG
 * (`orchestratePokemonPipeline`) puisse tourner de bout en bout (catalogue
 * + identification, via Pokémon TCG API/TCGdex, tous deux gratuits et sans
 * clé) même quand JustTCG n'est PAS configuré — sans cette source, TCGdex
 * pricing seul (également gratuit, déjà démontré en direct : Pikachu/Base
 * Set/#58 à 9.63 EUR via Cardmarket) reste exploitable, jamais un échec
 * total faute d'une clé optionnelle absente (lot "journée autonome",
 * Priorité 10 : "ne transforme pas un prix manquant en échec total").
 *
 * `orchestratePokemonPipeline` exige aujourd'hui un `justTcgPricingConnector`
 * non-optionnel dans `TcgPipelineConnectors` — plutôt que de modifier cette
 * signature (risque plus large, hors scope de ce lot), ce connecteur "vide"
 * comble la place sans changer le comportement du pipeline : une source qui
 * ne retourne jamais d'`exact_match` se comporte exactement comme n'importe
 * quelle source légitimement en panne ou sans résultat — déjà géré.
 */
export function createNoopPricingConnector(source: string, reason: string): PricingConnector {
  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source,
    displayName: `${source} (non configuré)`,
    family: "pricing",
    capabilities: ["pricing.lookup.v1"],
    supportedCategorySlugs: "any",
    declaredQuality: { reliability: 0, coverage: 0, freshness: 0, latency: 0, confidence: 0 },
    cost: { model: "free", details: reason },
    quotas: {},
    license: { allowsCommercialUse: true, allowsCaching: false, maxCacheAgeHours: null, allowsRedistribution: false, termsUrl: "" },
    cachePolicy: { ttlHours: 0, staleWhileRevalidate: false },
  };

  async function lookup(query: PricingQuery): Promise<NormalizedPriceObservation[]> {
    void query; // jamais consulté — ce connecteur ne retourne jamais d'observation, quelle que soit la requête.
    return [];
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    return { status: "degraded", checkedAt: new Date().toISOString(), latencyMs: 0, message: reason };
  }

  return { ...descriptor, lookup, healthCheck };
}
