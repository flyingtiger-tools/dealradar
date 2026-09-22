import type { UpcDevSuccessResponse } from "../raw-types";

/**
 * Fixtures issues d'appels RÉELS effectués ce lot (LOT "Live Identity
 * Enrichment + Barcode-First + upc.dev Fallback + Railway Readiness",
 * section 3, accès public sans clé) — `COCA_COLA_RESPONSE` confirme que ce
 * produit précis est backé par Open Food Facts (`image_url` pointe vers
 * `images.openfoodfacts.org`), jamais une donnée inventée.
 */
export const COCA_COLA_RESPONSE: UpcDevSuccessResponse = {
  ok: true,
  data: {
    upc: "0049000042566",
    name: "Coca-Cola Zero Sugar",
    brand: "Coca-Cola",
    category: "Bebidas, Bebidas gaseosas, Refrescos, Refrescos de cola",
    description: "CARBONATED WATER, CARAMEL COLOR, PHOSPHORIC ACID",
    image_url: "https://images.openfoodfacts.org/images/products/004/900/004/2566/front_en.5.400.jpg",
    created_at: "2026-04-12 04:54:19",
    updated_at: "2026-04-16 06:27:11",
  },
  timestamp: "2026-06-26T10:13:14.822Z",
};

/** Réponse `404` réelle observée ce lot — même pour un code-barres syntaxiquement invalide, `code: "INVALID_UPC"`, JAMAIS un code "NOT_FOUND" distinct malgré ce que suggère la doc OpenAPI publique. */
export const INVALID_UPC_404_BODY = { ok: false, error: "Invalid UPC pattern", code: "INVALID_UPC" };

/** Corps `503` réel observé ce lot pendant une fenêtre de démarrage à froid — TEXTE BRUT, jamais du JSON. */
export const WARMING_503_TEXT = "upc.dev is warming this page — please retry in a few seconds.";
