import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Watchlists" };

/** Watchlists — implémentation fonctionnelle au Lot 2. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Watchlists</h1>
      <EmptyState title="Aucune watchlist" description="Regroupez les annonces que vous suivez. Chaque liste affiche les verdicts et les mouvements de prix en continu." />
    </div>
  );
}
