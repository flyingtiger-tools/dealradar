import { cn } from "@/lib/cn";

/** Donnée chiffrée : toujours en face mono, label en face UI. */
export function Stat({
  label,
  value,
  trend,
  className,
}: {
  label: string;
  value: string;
  trend?: { direction: "up" | "down"; text: string };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs text-muted">{label}</span>
      <span className="font-data text-2xl font-medium tabular-nums">{value}</span>
      {trend ? (
        <span
          className={cn(
            "font-data text-xs tabular-nums",
            trend.direction === "up" ? "text-up" : "text-down",
          )}
        >
          {trend.direction === "up" ? "▲" : "▼"} {trend.text}
        </span>
      ) : null}
    </div>
  );
}
