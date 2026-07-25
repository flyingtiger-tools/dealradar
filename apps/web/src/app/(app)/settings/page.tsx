import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Paramètres" };

/** Paramètres — implémentation fonctionnelle au Lot 2. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Paramètres</h1>
      <EmptyState title="Paramètres par défaut actifs" description="Langue, devise, thème et préférences de notification seront réglables ici." />
    </div>
  );
}
