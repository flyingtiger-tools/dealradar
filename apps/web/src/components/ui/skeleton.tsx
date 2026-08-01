import { cn } from "@/lib/cn";

/**
 * Bloc de remplacement pendant le chargement — purement décoratif
 * (`aria-hidden`). Pour un groupe qui représente un état de chargement
 * identifiable, englober dans un conteneur `role="status"` avec un libellé
 * accessible plutôt que de compter sur le skeleton seul.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("motion-safe:animate-pulse rounded bg-line", className)} />;
}
