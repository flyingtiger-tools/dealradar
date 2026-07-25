import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Historique" };

/** Historique — implémentation fonctionnelle au Lot 3. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Historique</h1>
      <EmptyState title="Aucun historique de prix" description="Chaque annonce suivie construit son historique : baisses, hausses, temps de vente. La mémoire du marché commence ici." />
    </div>
  );
}
