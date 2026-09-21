import Constants from "expo-constants";
import { z } from "zod";
import { getCurrentAccessToken } from "../auth/session";

/**
 * Client `GET /api/internal/operator/product-history` (`apps/web`, LOT
 * "Interactive History + Generic Result UI + Full Cancellation + Pre-Prod
 * Activation Package", section 10) — pont read-only vers
 * `queryProductHistory` (`@dealradar/ingestion`, server-only). Même
 * discipline que `operator-observability-client.ts` : schéma Zod léger
 * (suffisant pour ne jamais laisser circuler un champ mal typé), jamais un
 * appel réseau sans session active, jamais un contrat produit stable
 * dupliqué ici (ce client reste interne).
 *
 * AUCUN champ de décision/prédiction dans ce schéma — reflète
 * volontairement `HistoryIntelligenceV2` (`@dealradar/core`), qui n'en
 * porte aucun (voir son en-tête : "jamais une précision fabriquée").
 */

const trendWindowSchema = z.object({
  windowDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(180)]),
  direction: z.enum(["up", "down", "flat", "insufficient"]),
  changePercent: z.number().nullable(),
  sampleSizeInWindow: z.number(),
});

const historyIntelligenceSchema = z.object({
  asOf: z.string(),
  sampleSize: z.number(),
  medianCents: z.number().nullable(),
  p25Cents: z.number().nullable(),
  p75Cents: z.number().nullable(),
  minCents: z.number().nullable(),
  maxCents: z.number().nullable(),
  outlierCount: z.number(),
  trends: z.array(trendWindowSchema),
  activeSupplyCount: z.number(),
  sourceDiversityOverTime: z.number(),
  historicalPercentilePosition: z.number().nullable(),
  confidence: z.number(),
  reasons: z.array(z.string()),
});

const recentSnapshotSummarySchema = z.object({
  cycleAt: z.string(),
  cycleKey: z.string(),
  currency: z.string(),
  lowCents: z.number().nullable(),
  fairCents: z.number().nullable(),
  highCents: z.number().nullable(),
  confidence: z.number().nullable(),
  observationCount: z.number(),
  sourceCount: z.number(),
});

const productHistoryResponseSchema = z.object({
  history: z.object({
    productKey: z.string(),
    asOf: z.string(),
    recentSnapshotSummaries: z.array(recentSnapshotSummarySchema),
    history: historyIntelligenceSchema,
    activeSupplyCount: z.number(),
    sourceDiversity: z.number(),
    freshnessHours: z.number().nullable(),
  }),
});

export type ProductHistoryResponse = z.infer<typeof productHistoryResponseSchema>;

const REQUEST_TIMEOUT_MS = 15_000;

function apiBaseUrl(): string {
  return (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:3000";
}

export class ProductHistoryError extends Error {
  constructor(
    public readonly code: "AUTH_REQUIRED" | "NETWORK_UNAVAILABLE" | "REQUEST_TIMEOUT" | "BACKEND_UNAVAILABLE" | "INVALID_RESPONSE" | "INVALID_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "ProductHistoryError";
  }
}

/** `null` sans session active — jamais un appel réseau non authentifié (même discipline que `operator-observability-client.ts`). */
export async function fetchProductHistory(productKey: string): Promise<ProductHistoryResponse> {
  if (!productKey) throw new ProductHistoryError("INVALID_REQUEST", "productKey requis.");

  const accessToken = await getCurrentAccessToken();
  if (!accessToken) throw new ProductHistoryError("AUTH_REQUIRED", "Aucune session active — connecte-toi avant de consulter l'historique.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl()}/api/internal/operator/product-history?productKey=${encodeURIComponent(productKey)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProductHistoryError("REQUEST_TIMEOUT", "Le serveur a mis trop de temps à répondre.");
      }
      throw new ProductHistoryError("NETWORK_UNAVAILABLE", "Impossible de joindre le service — vérifie ta connexion et réessaie.");
    }

    if (!response.ok) {
      const code = response.status === 401 ? "AUTH_REQUIRED" : "BACKEND_UNAVAILABLE";
      throw new ProductHistoryError(code, "Impossible de lire l'historique produit.");
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ProductHistoryError("INVALID_RESPONSE", "Réponse illisible du serveur.");
    }

    const parsed = productHistoryResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProductHistoryError("INVALID_RESPONSE", "Réponse inattendue du serveur.");
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}
