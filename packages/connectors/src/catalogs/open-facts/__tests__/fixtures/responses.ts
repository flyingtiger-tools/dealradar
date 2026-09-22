/**
 * Fixtures — échantillons RÉELS capturés depuis `world.openfoodfacts.org`
 * et `world.openproductsfacts.org` (LOT "Free/Open Sources + Real
 * Readiness + Live Smoke Tests", section 3/13). Jamais de données
 * inventées.
 */
import type { OpenFactsResponse } from "../../raw-types";

/** `world.openfoodfacts.org/api/v2/product/3017620422003.json` — Nutella. */
export const NUTELLA_FOUND: OpenFactsResponse = {
  code: "3017620422003",
  status: 1,
  status_verbose: "product found",
  product: {
    product_name: "Nutella",
    brands: "Nutella, Ferrero",
    categories: "Confectionary based spreads, Petit-déjeuners, Produits à tartiner, Produits à tartiner sucrés, Pâtes à tartiner, fr:Nutella, fr:Nuttela",
    categories_tags: ["en:breakfasts", "en:spreads", "en:sweet-spreads", "en:confectionary-based-spreads"],
    quantity: "400 g e",
    product_quantity: 400,
    product_quantity_unit: "g",
    packaging: "Plastic,fr:Pot en verre",
    image_url: "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.400.jpg",
    image_front_url: "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.400.jpg",
  },
};

/** `world.openproductsfacts.org/api/v2/product/3450970084468.json` — GEL WC blancheur. */
export const OPF_TOILET_GEL_FOUND: OpenFactsResponse = {
  code: "3450970084468",
  status: 1,
  status_verbose: "product found",
  product: {
    product_name: "GEL WC blancheur avec javel",
    brands: "eco +",
    categories: "Household chemicals, Toilet gel",
    categories_tags: ["en:home-garden", "en:household-supplies", "en:household-chemicals", "en:toilet-gel"],
    quantity: "750 ml",
    product_quantity: 750,
    product_quantity_unit: "ml",
    image_url: "https://images.openproductsfacts.org/images/products/345/097/008/4468/front_fr.5.400.jpg",
    image_front_url: "https://images.openproductsfacts.org/images/products/345/097/008/4468/front_fr.5.400.jpg",
  },
};

/** `world.openfoodfacts.org/api/v2/product/0000000000000.json` — code invalide. */
export const INVALID_CODE: OpenFactsResponse = {
  code: "00000000",
  status: 0,
  status_verbose: "no code or invalid code",
};

/** `world.openproductsfacts.org/api/v2/product/8710447452746.json` — introuvable. */
export const NOT_FOUND: OpenFactsResponse = {
  code: "8710447452746",
  status: 0,
  status_verbose: "product not found",
};

/**
 * `world.openproductsfacts.org/api/v2/product/3014230021404.json` — trouvaille
 * d'audit RÉELLE ce lot : `status: 0` alors que le code EXISTE, mais dans un
 * projet frère distinct (Open Beauty Facts) — jamais traité comme une
 * correspondance par ce connecteur (voir `isOpenFactsMatch`).
 */
export const FOUND_IN_SISTER_PROJECT: OpenFactsResponse = {
  code: "3014230021404",
  status: 0,
  status_verbose: "product found with a different product type: beauty",
};
