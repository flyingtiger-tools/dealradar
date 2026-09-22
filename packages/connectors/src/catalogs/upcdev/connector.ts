import type { CatalogConnector, CatalogItem, CatalogMatch, CatalogQuery, ConnectorDescriptor, HealthCheckResult } from "../../types";
import { ConnectorError } from "../../types";
import { createUpcDevClient, type UpcDevClientOptions } from "./client";
import { matchUpcDevProduct, normalizeUpcDevProduct } from "./normalize";
import { upcDevSuccessResponseSchema } from "./raw-types";

export interface UpcDevCatalogHints {
  upc?: string;
}

function isHints(value: unknown): value is UpcDevCatalogHints {
  return typeof value === "object" && value !== null;
}

export interface UpcDevCatalogConfig extends Omit<UpcDevClientOptions, "apiKey"> {
  apiKey: string;
}

/**
 * Catalog Connector upc.dev (LOT "Live Identity Enrichment + Barcode-First
 * + upc.dev Fallback + Railway Readiness", section 3) — repli de SECOND
 * RANG pour un code-barres exact, consulté SEULEMENT après Open Food
 * Facts/Open Products Facts/Wikidata (voir `identity-source-routing.ts`,
 * `@dealradar/ingestion`) : ces trois sources sont gratuites et sans clé,
 * upc.dev nécessite une clé (`UPCDEV_API_KEY`, palier gratuit 100
 * requêtes/jour confirmé par `POST /v1/auth/register` — voir
 * `docs/free-open-sources-audit.md`).
 *
 * `liveTested: true` — appels RÉELS effectués ce lot en accès public (sans
 * clé, palier "basic data" documenté par upc.dev lui-même comme
 * suffisant pour confirmer la forme de réponse ; un appel authentifié réel
 * avec `UPCDEV_API_KEY` n'a PAS pu être effectué, cette clé étant absente
 * de cet environnement — voir le handoff pour l'action humaine exacte
 * requise).
 */
export function createUpcDevCatalogConnector(config: UpcDevCatalogConfig): CatalogConnector {
  const client = createUpcDevClient(config);

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: "upcdev",
    displayName: "upc.dev",
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: "any",
    declaredQuality: {
      // Confirmé en direct ce lot pour un sous-ensemble de produits testés
      // (voir client.ts) — reliability/confidence reflètent qu'aucun appel
      // AUTHENTIFIÉ réel n'a pu être vérifié (UPCDEV_API_KEY absente ici).
      reliability: 55,
      coverage: 60,
      freshness: 50,
      latency: 55,
      confidence: 45,
    },
    cost: { model: "free", details: "Palier gratuit 100 requêtes/jour avec clé API en libre-service (POST /v1/auth/register, audit conditions d'utilisation ce lot) ; paliers payants au-delà, jamais requis pour ce connecteur." },
    quotas: { perDay: 100, notes: "Palier gratuit confirmé par la page de tarification publique upc.dev ce lot — au-delà : 429, jamais un appel silencieusement dégradé." },
    license: {
      // Confirmé par audit des conditions d'utilisation upc.dev ce lot
      // (upc.dev/terms) : "You get a perpetual license to use responses in
      // your product. You can cache, display, and derive from the data."
      // Seule restriction pertinente : jamais un dump brut en masse
      // redistribué (aucune pertinence ici, un lookup exact à la fois).
      allowsCommercialUse: true,
      allowsCaching: true,
      maxCacheAgeHours: 720,
      allowsRedistribution: false,
      termsUrl: "https://upc.dev/terms",
    },
    // TTL généreux (30 jours) — "mise en cache agressive" explicitement
    // demandée par le brief (section 3) pour ne jamais consommer le palier
    // gratuit 100/jour sur un code-barres déjà résolu récemment.
    cachePolicy: { ttlHours: 720, staleWhileRevalidate: true },
  };

  async function resolve(query: CatalogQuery): Promise<CatalogMatch[]> {
    const hints = isHints(query.hints) ? (query.hints as UpcDevCatalogHints) : {};
    if (!hints.upc) return [];

    let raw: unknown;
    try {
      raw = await client.getProduct(hints.upc);
    } catch (error) {
      // 404 = "aucun produit pour ce code-barres", confirmé en direct
      // comme le statut RÉEL utilisé par upc.dev même pour un format
      // syntaxiquement invalide (voir client.ts) — jamais une exception
      // remontée pour ce cas, exactement le même traitement que les
      // autres Catalog Connectors de ce lot pour un "non trouvé".
      if (error instanceof ConnectorError && (error.httpStatus === 404 || error.httpStatus === 400)) return [];
      throw error;
    }

    const parsed = upcDevSuccessResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse upc.dev invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    return [matchUpcDevProduct(parsed.data.data)];
  }

  async function getItem(externalId: string): Promise<CatalogItem | null> {
    let raw: unknown;
    try {
      raw = await client.getProduct(externalId);
    } catch (error) {
      if (error instanceof ConnectorError && (error.httpStatus === 404 || error.httpStatus === 400)) return null;
      throw error;
    }
    const parsed = upcDevSuccessResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse upc.dev invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    return normalizeUpcDevProduct(parsed.data.data);
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      // Code-barres confirmé exister en direct ce lot (voir client.ts) —
      // jamais un identifiant spécifique à DealRadar.
      await client.getProduct("049000042566");
      return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      if (error instanceof ConnectorError && error.httpStatus === 401) {
        return { status: "degraded", checkedAt, latencyMs: Date.now() - startedAt, message: "Clé upc.dev invalide ou absente (401)." };
      }
      return {
        status: "down",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Échec inconnu d'upc.dev.",
      };
    }
  }

  return { ...descriptor, resolve, getItem, healthCheck };
}
