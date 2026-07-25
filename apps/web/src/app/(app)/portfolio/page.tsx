import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Portfolio" };

/** Portfolio — implémentation fonctionnelle au Lot 2. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Portfolio</h1>
      <EmptyState title="Votre portfolio est vide" description="Ajoutez ce que vous possédez : DealRadar suit la valeur de revente et vous dit quand vendre." />
    </div>
  );
}
