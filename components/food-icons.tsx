"use client";

import { useLang } from "@/components/lang";
import type { Starch } from "@/lib/planner/tags";
import { cn } from "@/lib/utils";

// A small picture for the meal's main starch, and beans when it has pulses.
const STARCH_ICON: Record<Starch, string> = { potatoes: "🥔", pasta: "🍝", rice: "🍚", noodles: "🍜", bread: "🍞" };

export function FoodIcons({ starch, isPasta, isPulse, className }: { starch: Starch | null; isPasta?: boolean; isPulse?: boolean; className?: string }) {
  const { t } = useLang();
  const s = isPasta ? "pasta" : starch;
  if (!s && !isPulse) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 leading-none", className)}>
      {s && (
        <span role="img" aria-label={t.starch[s]} title={t.starch[s]}>
          {STARCH_ICON[s]}
        </span>
      )}
      {isPulse && (
        <span role="img" aria-label={t.board.pulses} title={t.board.pulses}>
          🫘
        </span>
      )}
    </span>
  );
}
