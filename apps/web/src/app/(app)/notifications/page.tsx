import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Notifications" };

/** Notifications — implémentation fonctionnelle au Lot 2. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Notifications</h1>
      <EmptyState title="Rien à signaler" description="Les alertes déclenchées et les événements de compte apparaîtront ici, en temps réel." />
    </div>
  );
}
