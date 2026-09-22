/**
 * Fixtures — réponse RÉELLE capturée depuis `prices.openfoodfacts.org`
 * (LOT "Free/Open Sources + Real Readiness + Live Smoke Tests", section
 * 6/13) : `GET /api/v1/prices?product_code=1541513213246&page_size=2`.
 * Jamais de données inventées.
 */
import type { OpenPricesResponse } from "../../raw-types";

export const ELEFAN_PRICE_OBSERVATIONS: OpenPricesResponse = {
  items: [
    {
      id: 1,
      product_code: "1541513213246",
      product_name: null,
      price: 27.7,
      currency: "EUR",
      price_is_discounted: false,
      date: "2023-11-27",
      location: {
        osm_address_country_code: "FR",
        osm_display_name: "L'Éléfàn, 32, Avenue Marcelin Berthelot, Capuche, Secteur 4, Grenoble, Isère, Auvergne-Rhône-Alpes, France métropolitaine, 38100, France",
      },
      created: "2023-11-27T11:37:13.979801Z",
    },
    {
      id: 2,
      product_code: "1541513213246",
      product_name: null,
      price: 27.7,
      currency: "EUR",
      price_is_discounted: false,
      date: "2025-12-31",
      location: {
        osm_address_country_code: "FR",
        osm_display_name: "L'Éléfàn, 32, Avenue Marcelin Berthelot, Capuche, Secteur 4, Grenoble, Isère, Auvergne-Rhône-Alpes, France métropolitaine, 38100, France",
      },
      created: "2025-12-31T14:42:58.104797Z",
    },
  ],
  total: 3,
};

export const EMPTY_RESPONSE: OpenPricesResponse = { items: [], total: 0 };
