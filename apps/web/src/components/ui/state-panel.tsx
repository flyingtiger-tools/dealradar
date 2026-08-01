import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Shell partagé pour les états "bloc" (vide, données insuffisantes, action
 * impossible) : bordure pointillée, texte centré, jamais un cul-de-sac
 * silencieux — `description` explique toujours pourquoi, `action` propose
 * toujours la suite. `EmptyState`, `InsufficientDataNotice` et
 * `ActionBlocked` en sont de fines spécialisations pour éviter de dupliquer
 * ce conteneur trois fois.
 */
export function StatePanel({
  title,
  description,
  action,
  size = "default",
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  size?: "default" | "compact";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 text-center",
        size === "compact" ? "py-8" : "py-16",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}
