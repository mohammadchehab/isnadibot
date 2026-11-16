import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/** The 11px medium label above a field or a group of rows. */
export function SkillDialogLabel({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span className={cn("text-11px font-medium leading-4 text-muted-foreground", className)}>
      {children}
    </span>
  );
}

/**
 * One 11px line under a field: how the import works, or what happens next. A `destructive`
 * line replaces the note it sits in place of, and never sits beside one.
 */
export function SkillDialogNote({
  children,
  tone = "muted",
}: {
  readonly children: ReactNode;
  readonly tone?: "muted" | "destructive";
}) {
  return (
    <p
      className={cn(
        "text-11px leading-4",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}
