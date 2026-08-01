import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const styles: Record<Variant, string> = {
  primary:
    "bg-body text-ink hover:opacity-90 font-medium",
  secondary:
    "border border-line bg-surface text-body hover:bg-raised",
  ghost: "text-muted hover:text-body hover:bg-raised",
  danger: "bg-down/10 text-down border border-down/30 hover:bg-down/20",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  /** Affiche un indicateur de chargement et désactive le bouton — remplace le swap manuel de libellé à chaque site d'appel. */
  loading?: boolean;
  /** Si fourni, demande confirmation avant d'exécuter `onClick` — pour les actions destructrices irréversibles uniquement. */
  confirmMessage?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", loading = false, confirmMessage, disabled, onClick, children, ...props },
    ref,
  ) => {
    function handleClick(event: MouseEvent<HTMLButtonElement>) {
      if (confirmMessage && !window.confirm(confirmMessage)) return;
      onClick?.(event);
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        onClick={handleClick}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded",
          "motion-safe:transition-[background-color,opacity,transform] motion-safe:duration-150 motion-safe:ease-out active:scale-[0.98]",
          "disabled:pointer-events-none disabled:opacity-50",
          size === "sm" ? "h-9 px-3 text-sm" : "h-10 px-4 text-sm",
          styles[variant],
          className,
        )}
        {...props}
      >
        {loading ? <Spinner size="sm" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
