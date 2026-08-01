import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Ligne de liste dense — même coquille que search-result-row, watchlist-item-row, alert-row, position-row. */
export function ListRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-4 px-4 py-3", className)} {...props} />;
}
