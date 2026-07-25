import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Statistiques" };

/** Statistiques — implémentation fonctionnelle au Lot 3. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Statistiques</h1>
      <EmptyState title="Pas encore de données" description="Tendances par catégorie, médianes de prix, saisonnalité : les statistiques s'alimentent dès l'ouverture du pipeline." />
    </div>
  );
}
