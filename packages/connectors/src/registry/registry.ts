import type { ConnectorDescriptor } from "../types";
import { DuplicateConnectorError, type ConnectorQuery } from "./types";

/**
 * Registre générique des connecteurs (ADR 0012 §Capability Engine +
 * Connector Registry). N'importe quel objet conforme à `ConnectorDescriptor`
 * peut s'enregistrer — le registre lui-même ne connaît jamais "eBay",
 * "JustTCG" ou "Pokémon TCG API" par leur nom : toute la logique
 * d'enregistrement et de recherche passe par les champs génériques du
 * contrat (`family`, `capabilities`, `supportedCategorySlugs`, `license`).
 */
/**
 * Clé d'unicité : `source` seul ne suffit pas — une même source (ex.
 * "tcgdex", LOT 7B) peut légitimement fournir à la fois un Catalog et un
 * Pricing Connector. L'unicité réelle est (source, family) : deux
 * connecteurs de la même famille et de la même source sont un doublon,
 * deux familles différentes de la même source ne le sont jamais.
 */
function entryKey(source: string, family: string): string {
  return `${family}:${source}`;
}

export class ConnectorRegistry {
  private readonly entries = new Map<string, ConnectorDescriptor>();

  register(connector: ConnectorDescriptor): void {
    const key = entryKey(connector.source, connector.family);
    if (this.entries.has(key)) {
      throw new DuplicateConnectorError(connector.source);
    }
    this.entries.set(key, connector);
  }

  list(): ConnectorDescriptor[] {
    return [...this.entries.values()];
  }

  /** `family` requis dès qu'une source peut porter plusieurs familles (ex. TCGdex) — sinon ambigu. */
  get(source: string, family: string): ConnectorDescriptor | null {
    return this.entries.get(entryKey(source, family)) ?? null;
  }

  query(criteria: ConnectorQuery = {}): ConnectorDescriptor[] {
    return this.list().filter((connector) => {
      if (criteria.family && connector.family !== criteria.family) return false;
      if (criteria.capability && !connector.capabilities.includes(criteria.capability)) return false;
      if (criteria.categorySlug) {
        const supported =
          connector.supportedCategorySlugs === "any" || connector.supportedCategorySlugs.includes(criteria.categorySlug);
        if (!supported) return false;
      }
      if (criteria.commercialUseRequired && !connector.license.allowsCommercialUse) return false;
      return true;
    });
  }
}
