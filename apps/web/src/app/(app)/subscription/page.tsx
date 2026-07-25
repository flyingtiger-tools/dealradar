import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Abonnement" };

/** Abonnement — implémentation fonctionnelle au Lot 4. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Abonnement</h1>
      <EmptyState title="Plan Découverte actif" description="Le plan Premium (alertes illimitées, statistiques avancées) ouvrira avec la facturation Stripe." />
    </div>
  );
}
