import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Recherche" };

/** Recherche — implémentation fonctionnelle au Lot 2. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Recherche</h1>
      <EmptyState title="Cherchez sur tout le marché" description="Une requête interroge toutes les sources à la fois : annonces, prix, verdicts. Le moteur arrive avec le pipeline de données." />
    </div>
  );
}
