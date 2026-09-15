import type { HistoryCategory, HistoryIdentity } from "./types";

/**
 * Clé de produit stable (LOT "beta product readiness", Phase 22) — pour
 * Pokémon TCG : `category|setName|collectorNumber|language|variant`,
 * normalisés (minuscules, trim, zéros de tête retirés du numéro de
 * collection). Jamais le nom seul comme identifiant quand une meilleure
 * donnée existe (set/numéro), mais ne casse jamais si `setName`/`variant`
 * sont absents — un champ manquant devient simplement une section vide de
 * la clé, jamais une exception.
 *
 * Numéro de collection : "058" et "58" doivent produire la MÊME clé (les
 * catalogues TCG paddent différemment selon la source) — les zéros de
 * tête sont retirés avant normalisation, jamais une comparaison de texte
 * brute qui laisserait "058" et "58" diverger silencieusement.
 */

function normalizeSegment(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeCollectorNumber(value: string | null): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return "";
  // Ne retire les zéros de tête QUE si le reste est purement numérique —
  // un numéro comme "H23" ne doit jamais être altéré au-delà d'un simple
  // trim/minuscule (voir normalizeSegment pour les autres cas).
  if (/^0+\d+$/.test(trimmed)) return trimmed.replace(/^0+/, "");
  return trimmed.toLowerCase();
}

export function buildProductKey(category: HistoryCategory, identity: Pick<HistoryIdentity, "name" | "setName" | "collectorNumber" | "language" | "variant">): string {
  const segments = [
    category,
    normalizeSegment(identity.setName),
    normalizeCollectorNumber(identity.collectorNumber),
    normalizeSegment(identity.language),
    normalizeSegment(identity.variant),
  ];
  // Le nom n'entre dans la clé QUE si aucune des données catalogue
  // (set/numéro) n'est disponible — sinon deux impressions différentes
  // d'une même carte identifiée par catalogue (même set+numéro) doivent
  // rester la MÊME clé même si le nom détecté varie légèrement (casse/
  // accents) d'un scan à l'autre.
  const hasCatalogData = segments[1] !== "" || segments[2] !== "";
  if (!hasCatalogData) segments.push(normalizeSegment(identity.name));
  return segments.join("|");
}
