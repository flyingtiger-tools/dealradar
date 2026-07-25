import type { Verdict as VerdictType } from "@dealradar/core";
import { cn } from "@/lib/cn";

/**
 * Le composant signature du produit : la réponse à « Know When ».
 * Trois états, toujours en face mono — un verdict se lit comme une cotation.
 */
const config: Record<VerdictType, { label: string; className: string }> = {
  buy: { label: "ACHETER", className: "text-up border-up/40 bg-up/10" },
  wait: { label: "ATTENDRE", className: "text-signal border-signal/40 bg-signal/10" },
  sell: { label: "VENDRE", className: "text-down border-down/40 bg-down/10" },
};

export function Verdict({ value, className }: { value: VerdictType; className?: string }) {
  const { label, className: colors } = config[value];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5",
        "font-data text-xs font-semibold tracking-widest",
        colors,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
