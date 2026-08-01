import { cn } from "@/lib/cn";

/**
 * Indicateur de chargement — rotation continue, réservée aux moments
 * d'attente réels (jamais une décoration). Décoratif par défaut
 * (`aria-hidden`) : dans un `Button`, `aria-busy` porte déjà l'information
 * pour les lecteurs d'écran. Passer `label` pour un usage autonome
 * (hors bouton) qui doit être annoncé.
 */
export function Spinner({
  size = "md",
  label,
  className,
}: {
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  return (
    <span className="inline-flex" role={label ? "status" : undefined} aria-label={label}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={cn("motion-safe:animate-spin", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4", className)}
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
      </svg>
    </span>
  );
}
