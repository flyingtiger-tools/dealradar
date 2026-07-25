import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

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
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        styles[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
