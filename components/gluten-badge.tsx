"use client";

import { cn } from "@/lib/utils";
import { useLang } from "@/components/lang";
import type { Status } from "@/lib/gluten/gate";

const STYLE: Record<Status, string> = {
  safe: "bg-primary/15 text-primary",
  needs_substitution: "bg-accent/40 text-accent-foreground",
  needs_check: "bg-warning/15 text-warning",
  blocked: "bg-destructive/15 text-destructive",
};

// `label` replaces the status words, e.g. "New · check gluten" for an El País idea.
export function GlutenBadge({ status, className, label }: { status: Status; className?: string; label?: string }) {
  const { t } = useLang();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        STYLE[status],
        className,
      )}
    >
      {label ?? t.status[status]}
    </span>
  );
}
