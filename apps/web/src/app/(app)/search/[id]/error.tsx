"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";

/** Filet de sécurité du segment `/search/[id]` — Next.js l'affiche à la place de la page si le rendu serveur échoue. */
export default function ListingDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4">
      <Link href="/search" className="text-sm text-muted underline underline-offset-4">
        ← Retour à la recherche
      </Link>
      <StatePanel
        title="Impossible de charger cette annonce"
        description="Une erreur est survenue. Réessayez, ou revenez à la recherche."
        action={<Button onClick={reset}>Réessayer</Button>}
      />
    </div>
  );
}
