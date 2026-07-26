import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-10 w-full rounded border border-line bg-raised px-3 text-sm text-body",
        "focus:border-signal focus:outline-none",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
