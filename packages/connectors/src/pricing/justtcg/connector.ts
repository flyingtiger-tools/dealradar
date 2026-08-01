import type {
  ConnectorDescriptor,
  HealthCheckResult,
  NormalizedPriceObservation,
  PricingConnector,
  PricingQuery,
} from "../../types";
import { ConnectorError } from "../../types";
import type { TcgCatalogHints, TcgProductKind } from "../../catalogs/tcg/types";
import { createJustTcgHttpClient, type JustTcgClientOptions } from "./client";
import { normalizeJustTcgCard } from "./normalize";
import { justTcgCardsResponseSchema } from "./raw-types";

export interface JustTcgConnectorConfig extends JustTcgClientOptions {
  categorySlug?: string;
}

/**
 * JustTCG ne couvre que des cartes (brutes et gradées) — aucun produit
 * scellé dans son schéma (confirmé par le code source officiel du SDK,
 * aucun endpoint/type "sealed"). Même refus honnête que le Catalog
 * Connector Pokémon TCG API.
 */
const SUPPORTED_KINDS: readonly TcgProductKind[] = ["raw_card", "graded_card"];

/** Seule région réellement servie aujourd'hui (`V2_SERVICEABLE_REGIONS` côté JustTCG) — jamais une autre. */
const SERVICEABLE_REGION = "US";

const CATEGORY_TO_GAME_SLUG: Record<string, string> = {
  pokemon_tcg: "pokemon",
};

function isHints(value: unknown): value is TcgCatalogHints {
  return typeof value === "object" && value !== null;
}

/**
 * Pricing Connector JustTCG (ADR 0012) — capacité versionnée `pricing.lookup.v1`.
 * Fournit un agrégat de marché nord-américain (USD), jamais une vente eBay
 * confirmée, jamais une valeur suisse/européenne (voir `normalize.ts` pour
 * l'avertissement systématique).
 */
export function createJustTcgPricingConnector(config: JustTcgConnectorConfig): PricingConnector {
  const client = createJustTcgHttpClient(config);
  const categorySlug = config.categorySlug ?? "pokemon_tcg";

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: "justtcg",
    displayName: "JustTCG",
    family: "pricing",
    capabilities: ["pricing.lookup.v1"],
    supportedCategorySlugs: [categorySlug],
    declaredQuality: {
      // Déclaré à l'écriture du connecteur : API stable, données de vente réelles
      // agrégées en continu, mais une seule région servie aujourd'hui (NA/US).
      reliability: 80,
      coverage: 45,
      freshness: 85,
      latency: 75,
      confidence: 65,
    },
    cost: {
      model: "freemium",
      details: "Gratuit (1 000 appels/mois, 100/jour) ; palier Starter $19/mois, Professional $49/mois, Enterprise $149/mois.",
    },
    quotas: {
      perDay: 100,
      notes: "Palier gratuit : 100/jour, 10/min, 1 000/mois. Paliers payants jusqu'à 50 000/jour (Enterprise). Voir cachePolicy pour limiter la consommation réelle.",
    },
    license: {
      // Confirmé par écrit (docs/commercial-use) : affichage aux utilisateurs et
      // usage commercial payant explicitement autorisés sur palier payant.
      allowsCommercialUse: true,
      allowsCaching: true,
      maxCacheAgeHours: null, // "There is no maximum retention period. Cache aggressively" — pas de limite déclarée par JustTCG.
      allowsRedistribution: false, // CGU : jamais revendre/redistribuer les données brutes comme flux autonome.
      termsUrl: "https://justtcg.com/docs/commercial-use",
    },
    cachePolicy: { ttlHours: 12, staleWhileRevalidate: true },
  };

  async function lookup(query: PricingQuery): Promise<NormalizedPriceObservation[]> {
    const hints = isHints(query.hints) ? (query.hints as TcgCatalogHints) : {};

    // Refus honnête : kind scellé — hors de portée de cette source, jamais une correspondance devinée.
    if (hints.kind && !SUPPORTED_KINDS.includes(hints.kind)) {
      return [];
    }

    if (!hints.name && !hints.setCode && !hints.collectorNumber) return [];

    const game = CATEGORY_TO_GAME_SLUG[query.categorySlug] ?? query.categorySlug;
    const isGraded = Boolean(hints.gradingCompany || hints.grade || hints.kind === "graded_card");

    // `hints.setCode` n'est jamais transmis à JustTCG : c'est un identifiant
    // du catalogue d'origine (ex. "base4" chez Pokémon TCG API), pas le slug
    // interne JustTCG (ex. "base-set-pokemon") — confirmé par appel réel :
    // transmettre "base4" comme `set` retourne silencieusement une liste
    // vide au lieu de la carte réelle. Même piège que l'id de set TCGdex
    // (voir pricing/tcgdex/normalize.ts) : la correspondance de set se fait
    // en aval, sur le nom, via `classifyCrossMatch` (LOT 3), jamais ici.
    const raw = await client.get("/cards", {
      q: hints.name,
      game,
      number: hints.collectorNumber,
      regions: SERVICEABLE_REGION,
      graded: isGraded ? "only" : "exclude",
      grading_company: isGraded ? hints.gradingCompany : undefined,
      grade: isGraded ? hints.grade : undefined,
      limit: 20,
    });

    const parsed = justTcgCardsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse JustTCG invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, {
        retryable: false,
      });
    }

    return parsed.data.data.flatMap((card) => normalizeJustTcgCard(card, hints));
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      await client.get("/cards", { game: "pokemon", limit: 1, regions: SERVICEABLE_REGION });
      return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: "down",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Échec inconnu de JustTCG.",
      };
    }
  }

  return { ...descriptor, lookup, healthCheck };
}
