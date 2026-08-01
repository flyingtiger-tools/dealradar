import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "error" | "success" | "info";

const TONE_CLASS: Record<Tone, string> = {
  error: "text-down",
  success: "text-up",
  info: "text-muted",
};

const TONE_ROLE: Record<Tone, "alert" | "status"> = {
  error: "alert",
  success: "status",
  info: "status",
};

/**
 * Message court en ligne (erreur de champ, confirmation d'action) —
 * remplace les `<p className="text-xs/sm text-down/up">` dispersés à la
 * main dans les formulaires. `role="alert"` pour une erreur (annoncé
 * immédiatement), `role="status"` sinon (annoncé sans interrompre).
 */
export function InlineNotice({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role={TONE_ROLE[tone]} className={cn("text-sm", TONE_CLASS[tone], className)}>
      {children}
    </p>
  );
}
