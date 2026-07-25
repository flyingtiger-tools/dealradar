import type { SourceAdapter } from "./source-adapter";

/**
 * Registre des adapters actifs.
 * Les implémentations concrètes (Leboncoin, Vinted, eBay…) arrivent au Lot 3,
 * chacune dans son fichier, enregistrée ici.
 */
const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  adapters.set(adapter.slug, adapter);
}

export function getAdapter(slug: string): SourceAdapter {
  const adapter = adapters.get(slug);
  if (!adapter) {
    throw new Error(`Adapter inconnu : "${slug}". Sources actives : ${[...adapters.keys()].join(", ") || "aucune"}.`);
  }
  return adapter;
}
