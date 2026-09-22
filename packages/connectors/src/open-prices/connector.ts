import type { MarketSource, MarketSourceQuery, MarketSourceResult } from "../market-intelligence/market-source";
import type { HealthCheckResult } from "../types";
import { ConnectorError } from "../types";
import { createOpenPricesClient, type OpenPricesClientOptions } from "./client";
import { normalizeOpenPricesItem } from "./normalize";
import { openPricesResponseSchema } from "./raw-types";

export interface OpenPricesConnectorOptions extends OpenPricesClientOptions {
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * MarketSource Open Prices (LOT "Free/Open Sources + Real Readiness + Live
 * Smoke Tests", section 6) — AUDIT DE CONFORMITÉ effectué ce lot :
 * - Licence ODbL (même famille qu'Open Food Facts) — la clause de partage
 *   à l'identique (§4.4/§4.5(b) ODbL) s'applique à une DATABASE DÉRIVÉE
 *   republiée, jamais à un "Produced Work" qui affiche le résultat d'une
 *   requête (ce que fait DealRadar) — attribution requise, jamais une
 *   republication de la base elle-même.
 * - Schéma de réponse CONFIRMÉ par appel réel ce lot (`GET /api/v1/prices
 *   ?product_code=1541513213246`), contrairement à une hypothèse non
 *   vérifiée.
 * - `evidenceType` TOUJOURS `"retailPrices"`, `evidenceTier` TOUJOURS `"E"`
 *   (le plus bas) : un prix scanné/observé en magasin par un contributeur
 *   communautaire n'est NI une vente confirmée NI une annonce active,
 *   JAMAIS traité comme une preuve plus forte que ce qu'elle est
 *   réellement.
 * - Lookup EXACT par code-barres uniquement (`hints.barcode`) — Open
 *   Prices n'offre aucune recherche floue fiable par texte ; `search`
 *   n'est donc JAMAIS déclarée dans `evidenceTypes` (contrairement à
 *   Google Shopping), pour ne jamais prétendre à une capacité absente.
 * - Projet plus jeune/moins mature qu'Open Food Facts (audit ce lot) —
 *   traité comme un signal COMPLÉMENTAIRE de faible confiance, jamais une
 *   source de prix primaire.
 */
export function createOpenPricesConnector(options: OpenPricesConnectorOptions = {}): MarketSource {
  const client = createOpenPricesClient(options);
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  return {
    source: "open_prices",
    displayName: "Open Prices",
    supportedCategorySlugs: "any",
    sourceKind: "aggregator",
    evidenceTypes: ["retailPrices"],

    async search(query: MarketSourceQuery): Promise<MarketSourceResult> {
      const hints = (query.hints ?? {}) as { barcode?: string };
      if (!hints.barcode) return { observations: [] };

      const collectedAt = new Date().toISOString();
      const raw = await client.getPricesByBarcode(hints.barcode, query.limit ?? pageSize, query.signal);
      const parsed = openPricesResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ConnectorError(`Réponse Open Prices invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
      }

      const observations = parsed.data.items.map((item) => normalizeOpenPricesItem(item, { categorySlug: query.categorySlug, query: query.q, collectedAt }));
      return { observations, hasMore: parsed.data.total !== undefined ? parsed.data.total > observations.length : undefined };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const checkedAt = new Date().toISOString();
      const startedAt = Date.now();
      try {
        // Code-barres réel connu pour exister sur Open Prices (audit ce
        // lot) — un tableau `items` même vide confirme un service qui
        // répond correctement, jamais interprété comme une panne.
        await client.getPricesByBarcode("1541513213246", 1);
        return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: "down",
          checkedAt,
          latencyMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : "Échec inconnu d'Open Prices.",
        };
      }
    },
  };
}
