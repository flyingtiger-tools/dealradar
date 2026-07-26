import type { ExtractedProduct } from "../validation/schemas";
import type { SourcedExtraction } from "../types";
import { detectConditionKeyword } from "./condition-keywords";
import { APPLE_PRODUCT_LINES, GAMING_PLATFORMS, PHOTO_BRANDS, PHOTO_LENS_KEYWORDS } from "./extraction-profiles";

/**
 * Incrémenté à chaque changement de comportement du parseur — entre dans la
 * clé de cache (une modification invalide silencieusement les entrées
 * existantes, jamais un résultat obsolète servi comme s'il était frais).
 */
export const DETERMINISTIC_EXTRACTOR_VERSION = 1;

function emptyProduct(): ExtractedProduct {
  return {
    brand: null,
    model: null,
    reference: null,
    category: null,
    subcategory: null,
    condition: null,
    language: null,
    color: null,
    capacity: null,
    accessories: null,
    serialNumberDetected: { value: false, confidence: 0.8, source: "deterministic" },
    attributes: {},
  };
}

function field(value: string, confidence: number) {
  return { value, confidence, source: "deterministic" as const };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyCondition(product: ExtractedProduct, text: string): void {
  const detected = detectConditionKeyword(text);
  if (detected) {
    product.condition = { value: detected.condition, confidence: detected.confidence, source: "deterministic" };
  }
}

/** Détection grossière d'une mention de numéro de série — jamais la valeur elle-même n'est extraite (correction 4 : booléen uniquement). */
function detectSerialNumberMention(text: string): boolean {
  return /\bserial\s*(number|no\.?|#)?\s*[:#]?\s*[a-z0-9-]{5,}/i.test(text) || /\bnum[ée]ro de s[ée]rie\b/i.test(text);
}

function extractLego(title: string, description: string, product: ExtractedProduct): void {
  const text = `${title} ${description}`;
  if (!/\blego\b/i.test(text)) return;
  product.brand = field("LEGO", 0.95);
  const match = text.match(/\b(\d{4,6})\b/);
  if (match?.[1]) {
    const setNumber = match[1];
    product.reference = field(setNumber, 0.9);
    product.attributes.setNumber = field(setNumber, 0.9);
  }
}

function extractApple(title: string, description: string, product: ExtractedProduct): void {
  const text = `${title} ${description}`;
  const line = APPLE_PRODUCT_LINES.find((candidate) => new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(text));
  if (!line) return;
  product.brand = field("Apple", 0.95);

  // N'étend le modèle qu'avec des qualificatifs reconnus (chiffres de génération,
  // Pro/Max/Plus/Mini/Air/Ultra) — jamais des mots de la phrase environnante
  // (ex. "en excellent état"), qui produiraient un modèle inventé.
  const modelMatch = text.match(
    new RegExp(`\\b${escapeRegExp(line)}((?:\\s+(?:\\d+(?!\\s?(?:GB|Go|TB|To)\\b)|Pro|Max|Plus|Mini|Air|Ultra))+)?`, "i"),
  );
  const model = (modelMatch?.[0] ?? line).trim();
  product.model = field(model, 0.9);
  product.attributes.model = field(model, 0.9);

  const storageMatch = text.match(/(\d{1,4})\s?(GB|Go|TB|To)\b/i);
  if (storageMatch?.[1] && storageMatch[2]) {
    const amount = Number(storageMatch[1]);
    const unit = storageMatch[2].toLowerCase();
    const storageGb = unit === "tb" || unit === "to" ? amount * 1024 : amount;
    product.capacity = field(`${storageMatch[1]}${storageMatch[2]}`, 0.9);
    product.attributes.storageGb = { value: storageGb, confidence: 0.9, source: "deterministic" };
  }
}

function extractPokemonTcg(title: string, description: string, product: ExtractedProduct): void {
  const text = `${title} ${description}`;
  const fractionMatch = text.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
  if (!fractionMatch?.[1] || !fractionMatch[2]) return;
  const setCode = `${fractionMatch[1]}/${fractionMatch[2]}`;
  product.attributes.setCode = field(setCode, 0.9);

  const before = text
    .slice(0, fractionMatch.index ?? 0)
    .replace(/pok[ée]mon/gi, "")
    .replace(/\bcarte\b|\bcard\b/gi, "")
    .trim();
  if (before.length > 1) {
    product.attributes.cardName = field(before, 0.85);
    product.model = field(before, 0.85);
  }
}

function extractGaming(title: string, description: string, product: ExtractedProduct): void {
  const text = `${title} ${description}`;
  const platform = GAMING_PLATFORMS.find((candidate) => new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(text));
  if (!platform) return;
  product.attributes.platform = field(platform, 0.95);

  const remaining = text
    .replace(new RegExp(escapeRegExp(platform), "i"), "")
    .replace(/\bjeu\b|\bgame\b|\bconsole\b|\boccasion\b|\bcomplet\b|\bCIB\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (remaining.length > 3) {
    product.attributes.productName = field(remaining, 0.85);
    product.model = field(remaining, 0.85);
  }
}

function extractPhoto(title: string, description: string, product: ExtractedProduct): void {
  const text = `${title} ${description}`;
  const brand = PHOTO_BRANDS.find((candidate) => new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(text));
  if (!brand) return;
  product.brand = field(brand, 0.9);

  const modelMatch = text.match(
    new RegExp(`\\b${escapeRegExp(brand)}\\s+([A-Za-z0-9][\\w-]*(?:\\s[A-Za-z0-9][\\w-]*){0,3})`, "i"),
  );
  const model = modelMatch?.[1]?.trim();
  if (model) {
    product.model = field(model, 0.85);
    product.attributes.model = field(model, 0.85);
  }

  const isLens = PHOTO_LENS_KEYWORDS.some((pattern) => pattern.test(text));
  product.attributes.gearType = field(isLens ? "lens" : "camera_body", 0.9);
}

const EXTRACTORS: Record<string, (title: string, description: string, product: ExtractedProduct) => void> = {
  lego: extractLego,
  apple: extractApple,
  pokemon_tcg: extractPokemonTcg,
  gaming: extractGaming,
  photo: extractPhoto,
};

/**
 * Extraction 100% locale, sans appel réseau — toujours essayée en premier.
 * Le dispatch par catégorie est le seul embranchement `if`/`Record` du
 * fichier ; chaque fonction de catégorie encapsule ses propres motifs.
 */
export function runDeterministicExtractor(input: {
  title: string;
  description?: string | null;
  categorySlug: string;
}): SourcedExtraction {
  const product = emptyProduct();
  const description = input.description ?? "";
  const text = `${input.title} ${description}`;

  applyCondition(product, text);
  product.serialNumberDetected = {
    value: detectSerialNumberMention(text),
    confidence: 0.8,
    source: "deterministic",
  };

  const extractor = EXTRACTORS[input.categorySlug];
  extractor?.(input.title, description, product);

  return { source: "deterministic", product };
}
