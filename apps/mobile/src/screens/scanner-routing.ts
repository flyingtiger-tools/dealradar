import type { CategorySlug } from "@dealradar/contracts";

/**
 * Décision de routage pure de `ScannerEntryScreen.tsx` (LOT "rendre le scan
 * universel accessible dans l'app") — extraite dans un module séparé pour
 * rester testable sans bibliothèque de rendu React Native (ce repo n'en a
 * pas, voir `navigation/__tests__/structure-isolation.test.ts`). Aucune
 * logique de rendu ici, seulement "quel corps d'écran pour quelle
 * catégorie" : le composant appelle cette fonction, il ne réimplémente
 * jamais la décision.
 */
export type ScannerBody = "picker" | "pokemon_tcg" | "universal";

/**
 * `null` -> sélecteur de catégorie (aucun choix encore fait). `pokemon_tcg`
 * -> `TcgScanScreen`, INCHANGÉ. Toute autre catégorie (y compris `general`)
 * -> `UniversalScanScreen`. Jamais de troisième branche cachée : une
 * catégorie non reconnue par `CategorySlug` ne peut pas exister au niveau
 * des types, donc ce switch est exhaustif par construction.
 */
export function resolveScannerBody(category: CategorySlug | null): ScannerBody {
  if (category === null) return "picker";
  if (category === "pokemon_tcg") return "pokemon_tcg";
  return "universal";
}
