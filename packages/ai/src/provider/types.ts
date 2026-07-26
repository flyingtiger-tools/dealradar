export interface AIProviderImage {
  url: string;
}

export interface AIProviderRequest {
  system: string;
  userText: string;
  images: AIProviderImage[];
}

export interface AIProviderUsage {
  inputUnits: number;
  outputUnits: number;
}

export interface AIProviderResponse {
  /** JSON brut retourné par le modèle — non validé ici, voir validation/schemas.ts. */
  raw: unknown;
  usage: AIProviderUsage;
}

/**
 * Interface multi-provider par conception — un seul provider concret
 * (OpenAI) est implémenté dans ce lot. Un futur adaptateur (Anthropic,
 * Gemini, modèle open-source) implémente cette même interface sans toucher
 * à l'orchestrateur (`extraction/extract-product.ts`).
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  extract(request: AIProviderRequest): Promise<AIProviderResponse>;
}
