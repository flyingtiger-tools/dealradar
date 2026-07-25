import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded border border-line bg-raised px-3 text-sm text-body",
        "placeholder:text-muted focus:border-signal focus:outline-none",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
