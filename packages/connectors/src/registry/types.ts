import type { ConnectorFamily } from "../types";

/**
 * Un `source` ne peut s'enregistrer qu'une fois, tous connecteurs confondus.
 * Un doublon signale presque toujours une double initialisation côté
 * appelant, jamais une situation à tolérer silencieusement.
 */
export class DuplicateConnectorError extends Error {
  constructor(source: string) {
    super(`Connecteur déjà enregistré : "${source}".`);
    this.name = "DuplicateConnectorError";
  }
}

/**
 * Critères de recherche — jamais un nom de connecteur. Toute résolution
 * passe par la famille, une capacité versionnée, une catégorie, et
 * éventuellement une exigence de licence commerciale.
 */
export interface ConnectorQuery {
  family?: ConnectorFamily;
  capability?: string;
  categorySlug?: string;
  /** Si `true`, exclut tout connecteur dont `license.allowsCommercialUse` est `false`. */
  commercialUseRequired?: boolean;
}
