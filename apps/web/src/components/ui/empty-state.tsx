import type { ReactNode } from "react";

/** Écran vide = invitation à agir, jamais un cul-de-sac. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}
