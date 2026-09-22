import type { CatalogConnector, CatalogItem, CatalogMatch, CatalogQuery, ConnectorDescriptor, HealthCheckResult } from "../../types";
import { ConnectorError } from "../../types";
import { createRebrickableClient, type RebrickableClientOptions } from "./client";
import { matchRebrickableSet, normalizeRebrickableSet } from "./normalize";
import { rebrickableSetSchema } from "./raw-types";

export interface RebrickableCatalogHints {
  setNumber?: string;
}

function isHints(value: unknown): value is RebrickableCatalogHints {
  return typeof value === "object" && value !== null;
}

/**
 * Rebrickable numérote ses sets `<numéro>-<variante>` (`"6608-1"`,
 * confirmé par la convention publique de longue date de Rebrickable —
 * quasi tous les sets n'ont qu'une seule variante `-1`) — un numéro SANS
 * suffixe (`"6608"`, forme la plus courante côté utilisateur/BrickLink)
 * reçoit `-1` par défaut, JAMAIS une variante devinée au-delà de ce
 * défaut documenté. Un numéro déjà suffixé passe tel quel.
 */
function normalizeSetNumber(setNumber: string): string {
  return /-\d+$/.test(setNumber) ? setNumber : `${setNumber}-1`;
}

export interface RebrickableCatalogConfig extends Omit<RebrickableClientOptions, "apiKey"> {
  apiKey: string;
}

/**
 * Catalog Connector Rebrickable (LOT "Free/Open Sources + Real Readiness +
 * Live Smoke Tests", section 4) — enrichissement d'IDENTITÉ LEGO
 * uniquement (nom, année, thème, nombre de pièces), jamais une source de
 * prix (voir BrickLink pour le prix). `liveTested: false` : aucune clé
 * `REBRICKABLE_API_KEY` disponible dans cet environnement ce lot (voir
 * `raw-types.ts` pour le détail de ce qui a pu/n'a pas pu être vérifié).
 */
export function createRebrickableCatalogConnector(config: RebrickableCatalogConfig): CatalogConnector {
  const client = createRebrickableClient(config);

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: "rebrickable",
    displayName: "Rebrickable",
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: ["lego"],
    declaredQuality: {
      // Déclaré à l'écriture du connecteur (audit ce lot) — API publique
      // réputée stable/exhaustive pour l'identité LEGO, mais AUCUN appel
      // authentifié réel effectué ce lot (REBRICKABLE_API_KEY absente) :
      // `reliability`/`confidence` reflètent cette incertitude, jamais un
      // chiffre optimiste non vérifié.
      reliability: 55,
      coverage: 80,
      freshness: 60,
      latency: 60,
      confidence: 45,
    },
    cost: { model: "free", details: "Gratuit, clé API en libre-service requise (aucun paiement, audit conditions d'utilisation ce lot)." },
    quotas: { perSecond: 1, notes: "~1 requête/seconde en moyenne documentée par les conditions d'utilisation Rebrickable, avec une tolérance de rafale limitée — non appliqué par ce client lui-même." },
    license: {
      // Confirmé par audit des conditions d'utilisation Rebrickable ce lot
      // (rebrickable.com/terms/) : usage commercial explicitement permis,
      // seules restrictions étroites = ne pas contourner leur marketplace
      // MOC Premium ni faire concurrence directe à leur activité
      // d'instructions de MOC — aucune des deux ne s'applique à DealRadar.
      allowsCommercialUse: true,
      allowsCaching: true,
      maxCacheAgeHours: 168,
      allowsRedistribution: false,
      termsUrl: "https://rebrickable.com/terms/",
    },
    cachePolicy: { ttlHours: 168, staleWhileRevalidate: true },
  };

  async function resolve(query: CatalogQuery): Promise<CatalogMatch[]> {
    const hints = isHints(query.hints) ? (query.hints as RebrickableCatalogHints) : {};
    if (!hints.setNumber) return [];

    let raw: unknown;
    try {
      raw = await client.getSet(normalizeSetNumber(hints.setNumber));
    } catch (error) {
      if (error instanceof ConnectorError && error.httpStatus === 404) return [];
      throw error;
    }

    const parsed = rebrickableSetSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse Rebrickable invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    return [matchRebrickableSet(parsed.data)];
  }

  async function getItem(externalId: string): Promise<CatalogItem | null> {
    let raw: unknown;
    try {
      raw = await client.getSet(externalId);
    } catch (error) {
      if (error instanceof ConnectorError && error.httpStatus === 404) return null;
      throw error;
    }
    const parsed = rebrickableSetSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse Rebrickable invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    return normalizeRebrickableSet(parsed.data);
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      // Set LEGO stable/ancien connu pour exister (choisi arbitrairement,
      // jamais un identifiant spécifique à DealRadar) — un 404 réel
      // signalerait un problème (numéro disparu de leur base), un succès
      // ou une 401 (clé invalide, jamais "down" pour autant, voir ci-dessous)
      // confirment que le service RÉPOND.
      await client.getSet("6608-1");
      return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      // Une clé invalide (401) signale une mauvaise CONFIGURATION, jamais
      // une panne de service — `degraded`, jamais `down`, pour ne pas
      // confondre les deux dans un diagnostic opérateur.
      if (error instanceof ConnectorError && error.httpStatus === 401) {
        return { status: "degraded", checkedAt, latencyMs: Date.now() - startedAt, message: "Clé Rebrickable invalide ou absente (401)." };
      }
      return {
        status: "down",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Échec inconnu de Rebrickable.",
      };
    }
  }

  return { ...descriptor, resolve, getItem, healthCheck };
}
