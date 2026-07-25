import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Compte" };

/** Compte — implémentation fonctionnelle au Lot 2. */
export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Compte</h1>
      <EmptyState title="Profil minimal" description="Gérez ici votre e-mail, votre mot de passe et la suppression de compte." />
    </div>
  );
}
