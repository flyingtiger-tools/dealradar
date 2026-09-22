import type { CatalogConnector, CatalogItem, CatalogMatch, CatalogQuery, ConnectorDescriptor, HealthCheckResult } from "../../types";
import { ConnectorError } from "../../types";
import { createOpenFactsHttpClient, type OpenFactsClientOptions } from "./client";
import { isOpenFactsMatch, matchOpenFactsProduct, normalizeOpenFactsProduct } from "./normalize";
import { openFactsResponseSchema } from "./raw-types";

/** Bag de hints minimal — EXACT uniquement, jamais un nom/texte libre (voir l'en-tête du fichier). */
export interface OpenFactsCatalogHints {
  barcode?: string;
}

function isHints(value: unknown): value is OpenFactsCatalogHints {
  return typeof value === "object" && value !== null;
}

const FIELDS = ["code", "status", "status_verbose", "product_name", "brands", "categories", "categories_tags", "quantity", "product_quantity", "product_quantity_unit", "packaging", "image_url", "image_front_url"] as const;

export interface OpenFactsCatalogConfig extends Omit<OpenFactsClientOptions, "baseUrl"> {
  /** Slug DealRadar par défaut si aucun n'est déterminable par l'appelant — jamais deviné depuis les données produit (Open Facts ne connaît pas la taxonomie DealRadar). */
  categorySlug?: string;
}

interface OpenFactsHostConfig {
  source: string;
  displayName: string;
  baseUrl: string;
  /** Reflète honnêtement la couverture réelle : Open Food Facts = alimentaire, Open Products Facts = produits non-alimentaires génériques — jamais "any" pour un connecteur dont la couverture catégorielle DealRadar reste large mais pas universelle. */
  supportedCategorySlugs: readonly string[] | "any";
}

/**
 * Fabrique PARTAGÉE — Open Food Facts et Open Products Facts sont le MÊME
 * backend Product Opener sous deux hôtes distincts (confirmé par appels
 * réels identiques ce lot, LOT "Free/Open Sources + Real Readiness + Live
 * Smoke Tests", section 3) : jamais deux implémentations qui pourraient
 * diverger silencieusement. ENRICHISSEMENT D'IDENTITÉ/CATALOGUE UNIQUEMENT
 * — ne fournit JAMAIS de preuve de prix (voir `normalize.ts`), et une
 * correspondance EXACTE de code-barres uniquement (jamais une recherche
 * floue par texte).
 */
function createOpenFactsCatalogConnector(host: OpenFactsHostConfig, config: OpenFactsCatalogConfig = {}): CatalogConnector {
  const client = createOpenFactsHttpClient({ ...config, baseUrl: host.baseUrl });
  const defaultCategorySlug = config.categorySlug ?? "general";

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: host.source,
    displayName: host.displayName,
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: host.supportedCategorySlugs,
    declaredQuality: {
      // Déclaré à l'écriture du connecteur (audit ce lot) : base collaborative
      // volumineuse pour Open Food Facts, nettement plus clairsemée pour Open
      // Products Facts (confirmé par sondage réel de codes-barres génériques
      // ce lot — plusieurs codes plausibles introuvables). Aucune télémétrie
      // en production encore.
      reliability: 70,
      coverage: host.source === "open_food_facts" ? 65 : 30,
      freshness: 50,
      latency: 60,
      confidence: 60,
    },
    cost: { model: "free", details: "Gratuit, aucune clé API, aucune authentification requise pour une lecture (confirmé par appel réel)." },
    quotas: { notes: "Aucune limite numérique publiée officiellement (audit ce lot) — User-Agent explicite envoyé par précaution, jamais vérifié comme bloquant." },
    license: {
      // Confirmé par audit ce lot (conditions d'utilisation officielles) :
      // ODbL — mais la clause de partage à l'identique (§4.4/§4.5(b) ODbL)
      // ne s'applique qu'à une DATABASE DÉRIVÉE republiée, jamais à un
      // "Produced Work" qui se contente d'afficher le résultat d'une
      // requête (ce que fait DealRadar ici) — attribution requise
      // (mention + lien), jamais une republication de la base elle-même.
      allowsCommercialUse: true,
      allowsCaching: true,
      maxCacheAgeHours: 24,
      allowsRedistribution: false,
      termsUrl: "https://world.openfoodfacts.org/terms-of-use",
    },
    cachePolicy: { ttlHours: 24, staleWhileRevalidate: true },
  };

  async function resolve(query: CatalogQuery): Promise<CatalogMatch[]> {
    const hints = isHints(query.hints) ? (query.hints as OpenFactsCatalogHints) : {};
    if (!hints.barcode) return [];

    let raw: unknown;
    try {
      raw = await client.getProductByBarcode(hints.barcode, FIELDS);
    } catch (error) {
      if (error instanceof ConnectorError && error.httpStatus === 404) return [];
      throw error;
    }

    const parsed = openFactsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse Open Facts invalide (${host.source}) : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    if (!isOpenFactsMatch(parsed.data)) return [];

    return [matchOpenFactsProduct(parsed.data, host.source, host.baseUrl, query.categorySlug || defaultCategorySlug)];
  }

  async function getItem(externalId: string): Promise<CatalogItem | null> {
    const raw = await client.getProductByBarcode(externalId, FIELDS);
    const parsed = openFactsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse Open Facts invalide (${host.source}) : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    if (!isOpenFactsMatch(parsed.data)) return null;
    return normalizeOpenFactsProduct(parsed.data, host.source, host.baseUrl, defaultCategorySlug);
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      // Code-barres factice connu pour n'exister nulle part (préfixe
      // réservé aux tests) — un statut 0/"not found" HTTP 200 est un
      // health-check RÉUSSI (le service répond correctement), jamais
      // interprété comme une panne.
      await client.getProductByBarcode("0000000000000", ["code", "status"]);
      return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: "down",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : `Échec inconnu de ${host.displayName}.`,
      };
    }
  }

  return { ...descriptor, resolve, getItem, healthCheck };
}

export function createOpenFoodFactsCatalogConnector(config: OpenFactsCatalogConfig = {}): CatalogConnector {
  return createOpenFactsCatalogConnector(
    { source: "open_food_facts", displayName: "Open Food Facts", baseUrl: "https://world.openfoodfacts.org", supportedCategorySlugs: ["general", "collectibles"] },
    config,
  );
}

export function createOpenProductsFactsCatalogConnector(config: OpenFactsCatalogConfig = {}): CatalogConnector {
  return createOpenFactsCatalogConnector(
    { source: "open_products_facts", displayName: "Open Products Facts", baseUrl: "https://world.openproductsfacts.org", supportedCategorySlugs: "any" },
    config,
  );
}
