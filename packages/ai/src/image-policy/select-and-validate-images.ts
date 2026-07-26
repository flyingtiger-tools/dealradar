export interface SelectableImage {
  url: string;
  position: number;
}

export interface ImageSelectionOptions {
  allowedDomains: string[];
  maxImages?: number;
}

const DEFAULT_MAX_IMAGES = 4;

function isAllowedDomain(hostname: string, allowedDomains: string[]): boolean {
  const lower = hostname.toLowerCase();
  return allowedDomains.some((domain) => lower === domain.toLowerCase() || lower.endsWith(`.${domain.toLowerCase()}`));
}

/**
 * Politique d'image restreinte (correction 4) : n'accepte que des images
 * déjà collectées par un connecteur autorisé (jamais une URL fournie
 * arbitrairement ailleurs), HTTPS obligatoire, domaine dans une allowlist
 * configurable, plafonnées à `maxImages`. Une image hors politique est
 * simplement ignorée, jamais fatale pour le reste de l'extraction.
 */
export function selectAllowedImages(images: SelectableImage[], options: ImageSelectionOptions): SelectableImage[] {
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const accepted: SelectableImage[] = [];

  for (const image of [...images].sort((a, b) => a.position - b.position)) {
    if (accepted.length >= maxImages) break;
    let parsed: URL;
    try {
      parsed = new URL(image.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    if (!isAllowedDomain(parsed.hostname, options.allowedDomains)) continue;
    accepted.push(image);
  }

  return accepted;
}
