import type { ItemCondition, AlertKind } from "@dealradar/core";

/** Libellés FR partagés entre les formulaires et les vues liste. */
export const CONDITION_OPTIONS: { value: ItemCondition; label: string }[] = [
  { value: "new", label: "Neuf" },
  { value: "like_new", label: "Comme neuf" },
  { value: "very_good", label: "Très bon état" },
  { value: "good", label: "Bon état" },
  { value: "fair", label: "État correct" },
  { value: "for_parts", label: "Pour pièces" },
];

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  price_below: "Prix en dessous d'un seuil",
  new_match: "Nouvelle annonce correspondante",
  verdict_change: "Changement de verdict",
  back_in_market: "Retour sur le marché",
};
