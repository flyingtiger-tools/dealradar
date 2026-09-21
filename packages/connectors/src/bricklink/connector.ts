import { createBrickLinkHttpClient, type BrickLinkClientOptions } from "./client";
import { normalizeBrickLinkPriceGuide } from "./normalize";
import type { BrickLinkPriceGuideResponse, BrickLinkGuideType, BrickLinkNewOrUsed } from "./raw-types";
import type { MarketSource, MarketSourceQuery, MarketSourceResult } from "../market-intelligence/market-source";
import type { HealthCheckResult } from "../types";
import { ConnectorError } from "../types";
import type { MarketObservation } from "../market-intelligence/market-observation";

export interface BrickLinkConnectorOptions extends BrickLinkClientOptions {
  /** Type d'article BrickLink par défaut si `hints.bricklinkType` n'est pas fourni — "SET" couvre l'immense majorité des cas DealRadar (catégorie `lego`). */
  defaultItemType?: string;
}

const GUIDE_TYPES: readonly BrickLinkGuideType[] = ["sold", "stock"];
const CONDITIONS: readonly BrickLinkNewOrUsed[] = ["N", "U"];

/**
 * Connecteur BrickLink officiel (LOT "Multi-Source Fusion + Source Wave
 * 1") — API v3 Price Guide, OAuth 1.0a (`oauth1.ts`). Déclare
 * `historicalPrices` (guide "sold", Tier B — voir `normalize.ts` pour la
 * décision détaillée) + `activeListings` (guide "stock", Tier D) —
 * **jamais `soldTransactions`** tant que l'API n'a pas été vérifiée en
 * conditions réelles comme fournissant des horodatages de vente
 * individuels fiables.
 *
 * `search()` exige `query.hints.bricklinkNo` (le numéro de set BrickLink,
 * ex. "75192") — un lookup par référence directe, jamais une recherche
 * floue par texte libre (l'API Price Guide de BrickLink n'en fournit pas ;
 * la résolution texte -> numéro de set reste la responsabilité de
 * l'appelant, ex. via le profil de catégorie `lego`
 * (`requiredAttributeKeys: ["setNumber", ...]`, `@dealradar/core`), jamais
 * devinée ici). Sans ce hint, retourne un résultat vide — jamais une
 * exception, dégradation gracieuse comme le reste du pipeline.
 *
 * **Credentials `BRICKLINK_CONSUMER_KEY`/`BRICKLINK_CONSUMER_SECRET`/
 * `BRICKLINK_TOKEN`/`BRICKLINK_TOKEN_SECRET` — jamais loggués.**
 */
export function createBrickLinkConnector(options: BrickLinkConnectorOptions): MarketSource {
  const client = createBrickLinkHttpClient(options);
  const defaultItemType = options.defaultItemType ?? "SET";

  async function fetchOneGuide(
    itemType: string,
    itemNo: string,
    guideType: BrickLinkGuideType,
    newOrUsed: BrickLinkNewOrUsed,
    query: MarketSourceQuery,
    collectedAt: string,
  ): Promise<MarketObservation | null> {
    const raw = (await client.get(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}/price`, {
      guide_type: guideType,
      new_or_used: newOrUsed,
    })) as BrickLinkPriceGuideResponse;

    return normalizeBrickLinkPriceGuide(raw, { categorySlug: query.categorySlug, query: query.q, guideType, collectedAt });
  }

  return {
    source: "bricklink",
    displayName: "BrickLink",
    supportedCategorySlugs: ["lego"],
    evidenceTypes: ["historicalPrices", "activeListings"],

    async search(query: MarketSourceQuery): Promise<MarketSourceResult> {
      const itemNo = query.hints?.bricklinkNo;
      if (typeof itemNo !== "string" || itemNo.length === 0) return { observations: [] };
      const itemType = typeof query.hints?.bricklinkType === "string" ? query.hints.bricklinkType : defaultItemType;
      const collectedAt = new Date().toISOString();

      const attempts = GUIDE_TYPES.flatMap((guideType) => CONDITIONS.map((newOrUsed) => ({ guideType, newOrUsed })));

      const observations: MarketObservation[] = [];
      for (const { guideType, newOrUsed } of attempts) {
        try {
          const observation = await fetchOneGuide(itemType, itemNo, guideType, newOrUsed, query, collectedAt);
          if (observation) observations.push(observation);
        } catch (error) {
          // Une combinaison guide/état sans donnée (BrickLink répond souvent
          // 404 quand aucune vente/stock n'existe pour cet état précis)
          // n'interrompt jamais les autres combinaisons — dégradation
          // gracieuse, même discipline que le reste du pipeline.
          if (error instanceof ConnectorError && error.httpStatus === 404) continue;
          throw error;
        }
      }

      return { observations };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const checkedAt = new Date().toISOString();
      const startedAt = Date.now();
      try {
        await client.get("/items/SET/1-1/price", { guide_type: "stock", new_or_used: "N" });
        return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: "down",
          checkedAt,
          latencyMs: null,
          message: error instanceof ConnectorError ? error.message : "Erreur inconnue lors du contrôle de santé BrickLink.",
        };
      }
    },
  };
}
