"use client";

import type { Decision } from "@dealradar/core";
import { cn } from "@/lib/cn";
import { useMountTransition } from "@/lib/use-mount-transition";

/**
 * Badge à 4 états pour la décision Intelligence Core (ADR 0007/0012).
 * Isolé du `Verdict` réel (components/ui/verdict.tsx, 3 états buy/wait/sell,
 * système de scoring distinct) — même langage visuel (couleur + label +
 * accent), étendu avec un glyphe distinct par état pour ne jamais dépendre
 * uniquement de la couleur (daltonisme, contraste).
 */
const config: Record<Decision, { label: string; glyph: string; className: string }> = {
  BUY: { label: "ACHETER", glyph: "▲", className: "text-up border-up/40 bg-up/10" },
  REVIEW: { label: "À VÉRIFIER", glyph: "◆", className: "text-signal border-signal/40 bg-signal/10" },
  PASS: { label: "PASSER", glyph: "▼", className: "text-down border-down/40 bg-down/10" },
  INSUFFICIENT_DATA: { label: "DONNÉES INSUFFISANTES", glyph: "○", className: "text-muted border-line bg-raised" },
};

export function DecisionBadge({
  value,
  size = "md",
  className,
}: {
  value: Decision;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { label, glyph, className: colors } = config[value];

  // Entrée douce à chaque changement de décision — se redéclenche à chaque
  // nouvelle valeur, respecte prefers-reduced-motion via `motion-safe:`.
  const mounted = useMountTransition([value]);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded border font-data font-semibold tracking-widest",
        "motion-safe:transition-[opacity,transform] motion-safe:duration-150 motion-safe:ease-out",
        mounted ? "opacity-100 motion-safe:scale-100" : "opacity-0 motion-safe:scale-95",
        size === "lg" ? "px-3 py-1.5 text-sm" : size === "sm" ? "px-1.5 py-0.5 text-2xs" : "px-2 py-1 text-xs",
        colors,
        className,
      )}
    >
      <span aria-hidden className="leading-none">
        {glyph}
      </span>
      {label}
    </span>
  );
}
