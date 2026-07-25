import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Alertes" };

/** Alertes — implémentation fonctionnelle au Lot 2. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Alertes</h1>
      <EmptyState title="Aucune alerte pour l'instant" description="Créez une alerte de prix ou de verdict : DealRadar surveille le marché à votre place et vous prévient au bon moment." />
    </div>
  );
}
