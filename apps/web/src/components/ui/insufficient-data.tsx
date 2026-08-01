import type { ReactNode } from "react";
import { StatePanel } from "./state-panel";

/**
 * État "insufficient_data" (pipeline d'analyse ou tout autre calcul qui
 * manque d'informations). Compact par défaut : généralement affiché au
 * sein d'un écran existant, pas en remplacement de page entière.
 */
export function InsufficientDataNotice({
  title = "Données insuffisantes",
  description = "Pas assez d'informations pour produire un résultat fiable. Complétez les champs manquants pour réessayer.",
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return <StatePanel title={title} description={description} action={action} size="compact" className={className} />;
}
