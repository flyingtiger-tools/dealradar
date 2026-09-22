import type { DetectedBarcode } from "./types";

/**
 * Familles de code-barres RÉELLEMENT exploitables comme identifiant produit
 * GTIN (LOT "Live Identity Enrichment + Barcode-First + upc.dev Fallback +
 * Railway Readiness", section 2) — jamais `qr`/`aztec`/`pdf417`/
 * `datamatrix`/`code39`/`code93`/`codabar`/`code128` (formats génériques
 * pouvant encoder n'importe quoi — URL, numéro de série interne — jamais
 * un GTIN par convention). `itf14` couvre GTIN-14 nativement. `ean13`
 * couvre aussi l'ISBN-13 (préfixe 978/979) sans traitement séparé — un
 * ISBN-13 EST un EAN-13 valide par construction GS1, jamais une famille
 * distincte à gérer.
 */
const GTIN_RELEVANT_FORMATS = new Set(["ean13", "ean8", "upc_a", "itf14"]);

/**
 * `upc_e` (format compressé 6-8 chiffres) est CAPTÉ par la caméra
 * (`SUPPORTED_BARCODE_TYPES`) mais JAMAIS normalisé en GTIN ce lot —
 * décision délibérée, pas un oubli : l'expansion UPC-E → UPC-A suit un
 * algorithme standard, mais aucun appareil/produit réel n'était disponible
 * cette session pour vérifier une implémentation contre un vrai code
 * scanné. Plutôt que de risquer un GTIN FAUX (donc un produit mal
 * identifié) avec un algorithme jamais vérifié en conditions réelles, un
 * `upc_e` scanné retombe simplement sur le chemin visuel/IA existant —
 * jamais un identifiant deviné.
 */
export const UNSUPPORTED_BARCODE_FORMATS_FOR_LOOKUP = new Set(["upc_e"]);

/**
 * Normalise un code-barres détecté vers sa forme GTIN numérique native
 * (jamais un padding artificiel vers GTIN-14 — la forme EAN-13/UPC-A/EAN-8
 * NATIVE est celle confirmée fonctionner par appel réel contre Open Food
 * Facts ce lot, voir `docs/free-open-sources-audit.md`; un padding non
 * vérifié risquerait de casser une correspondance qui fonctionne
 * aujourd'hui). `null` pour tout format non pertinent ou une valeur qui ne
 * contient aucun chiffre exploitable.
 */
export function normalizeBarcodeToGtin(barcode: DetectedBarcode): string | null {
  if (!GTIN_RELEVANT_FORMATS.has(barcode.format)) return null;
  const digits = barcode.rawValue.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Sélectionne le MEILLEUR candidat parmi les code-barres détectés pendant
 * une capture — le premier qui se normalise en GTIN exploitable, dans
 * l'ordre de détection (jamais un tri par confiance inventé : la caméra ne
 * fournit aucun score de confiance par code, voir `DetectedBarcode`).
 * `null` si aucun candidat exploitable (tous non-GTIN, ou tous `upc_e`).
 */
export function selectBestBarcodeForLookup(barcodes: readonly DetectedBarcode[]): string | null {
  for (const barcode of barcodes) {
    const normalized = normalizeBarcodeToGtin(barcode);
    if (normalized) return normalized;
  }
  return null;
}
