/**
 * Identité produit canonique (LOT "Historical Data Engine + Product
 * Identity Enrichment + Live-Readiness", section 1) — la forme UNIQUE et
 * durable sous laquelle DealRadar reconnaît "le même produit" à travers
 * des sources hétérogènes (eBay, BrickLink, PriceCharting, Keepa, Google
 * Shopping, DataForSEO, un scan IA, un code-barres...), indépendamment de
 * la manière dont chaque source l'identifie chez elle.
 *
 * Fonction PURE, aucune dépendance à `@dealradar/connectors` (même
 * discipline que `fuse-market-observations.ts`/`history-signals.ts`) — ce
 * module ne sait RIEN d'un `MarketObservation`, seulement de champs
 * d'identité déjà extraits par l'appelant (`packages/ingestion`).
 *
 * Règle absolue : AUCUNE valeur d'identifiant n'est jamais fabriquée ici.
 * `productKey` est la SEULE valeur que ce module peut légitimement générer
 * lui-même (une clé interne DealRadar, jamais présentée comme un
 * identifiant externe comme un UPC/EAN/ASIN) — dérivée de manière
 * déterministe et reproductible à partir des champs d'identité connus au
 * moment de la création, jamais aléatoire.
 */

/** Une valeur de champ accompagnée de sa PROVENANCE — jamais un champ nu sans savoir qui l'affirme, quand, avec quelle confiance. */
export interface FieldClaim<T = string> {
  value: T;
  /** Nom de source (connecteur, "ai_identification", "barcode_scan", "user_scan", ou un alias de source persistée) — jamais une valeur de credential. */
  source: string;
  /** 0–1, confiance de CETTE affirmation précise — jamais une confiance globale de l'identité entière. */
  confidence: number;
  observedAt: string;
}

/**
 * Champs "durs" (LOT, section 2) — un désaccord entre deux affirmations
 * sur l'un de ces champs est un CONFLIT explicite, jamais résolu
 * silencieusement par un simple écrasement. Inclut tous les identifiants
 * structurels (jamais deux UPC différents pour "le même" produit sans
 * preuve) et les attributs qui changent fondamentalement le produit
 * (mauvais stockage/taille/édition/plateforme/numéro de set).
 */
export const HARD_CONFLICT_FIELDS = [
  "mpn",
  "gtin",
  "ean",
  "upc",
  "asin",
  "bricklinkNo",
  "priceChartingId",
  "platform",
  "storage",
  "size",
  "edition",
] as const;
export type HardConflictField = (typeof HARD_CONFLICT_FIELDS)[number];

/**
 * Champs "doux" — un désaccord peut survenir (ex. deux libellés de couleur
 * légèrement différents) mais n'empêche jamais la fusion : la claim la
 * plus digne de confiance l'emporte, jamais un blocage.
 */
export const SOFT_FIELDS = [
  "brand",
  "model",
  "variant",
  "color",
  "generation",
  "region",
  "language",
  "styleCode",
  "sku",
  "normalizedConditionTarget",
] as const;
export type SoftField = (typeof SOFT_FIELDS)[number];

export type IdentityField = HardConflictField | SoftField;
export const ALL_IDENTITY_FIELDS: readonly IdentityField[] = [...HARD_CONFLICT_FIELDS, ...SOFT_FIELDS];

export type IdentityFieldClaims = { [K in IdentityField]?: FieldClaim | null };

export interface IdentityFieldConflict {
  field: HardConflictField;
  /** Les affirmations effectivement en désaccord — jamais résumées en une seule valeur "gagnante". */
  claims: FieldClaim[];
}

export interface CanonicalProductIdentity {
  /** Clé interne DealRadar stable — voir `deriveProductKey`. Jamais un identifiant externe. */
  productKey: string;
  categorySlug: string;
  fields: IdentityFieldClaims;
  /** Identifiants/alias spécifiques à une source qui ne rentrent dans AUCUN champ structuré ci-dessus (ex. un id de listing marketplace interne) — jamais perdus, jamais forcés dans un champ auquel ils ne correspondent pas. `field` est le nom LIBRE donné par la source (ex. "googleProductId"), jamais l'un des `IdentityField` structurés. */
  aliases: (FieldClaim & { field: string })[];
  /** Conflits actuellement NON résolus — jamais vidé automatiquement, une résolution est toujours un acte explicite de l'appelant (voir `resolveIdentityConflict`). */
  conflicts: IdentityFieldConflict[];
}

function slugifyToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Dérive `productKey` de manière DÉTERMINISTE à partir des champs
 * d'identité connus — la MÊME combinaison catégorie+marque+modèle+variante
 * (+stockage/taille si connus) produit TOUJOURS la même clé, jamais une
 * valeur aléatoire/horodatée. Champs structurants choisis pour maximiser
 * la stabilité : moins de champs disponibles -> une clé plus large mais
 * toujours reproductible (jamais un échec si peu d'informations sont
 * connues, jamais un identifiant vide non plus — `categorySlug` seul
 * suffit comme filet de sécurité ultime).
 */
export function deriveProductKey(categorySlug: string, seedFields: Partial<Record<IdentityField, string>>): string {
  const parts = [categorySlug, seedFields.brand, seedFields.model, seedFields.variant, seedFields.storage, seedFields.size, seedFields.color]
    .filter((v): v is string => Boolean(v && v.trim().length > 0))
    .map(slugifyToken);
  return parts.join(":");
}

export function createCanonicalProductIdentity(categorySlug: string, productKey?: string): CanonicalProductIdentity {
  return {
    productKey: productKey ?? deriveProductKey(categorySlug, {}),
    categorySlug,
    fields: {},
    aliases: [],
    conflicts: [],
  };
}

export function isHardConflictField(field: IdentityField): field is HardConflictField {
  return (HARD_CONFLICT_FIELDS as readonly string[]).includes(field);
}
