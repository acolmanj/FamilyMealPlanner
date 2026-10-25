import { cn } from "@/lib/utils";
import { STATUS_LABEL, type Status } from "@/lib/gluten/gate";

const STYLE: Record<Status, string> = {
  safe: "bg-primary/15 text-primary",
  needs_substitution: "bg-accent/40 text-accent-foreground",
  needs_check: "bg-warning/15 text-warning",
  blocked: "bg-destructive/15 text-destructive",
};

export function GlutenBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        STYLE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
