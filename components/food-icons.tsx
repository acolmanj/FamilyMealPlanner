"use client";

import { useId } from "react";

import { useLang } from "@/components/lang";
import type { Starch } from "@/lib/planner/tags";
import { cn } from "@/lib/utils";

// Two plain cooked penne, no sauce: there is no emoji for plain pasta.
function PlainPasta() {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className="inline-block h-[1.2em] w-[1.2em] align-[-0.2em]" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde3a0" />
          <stop offset="0.55" stopColor="#f5c95e" />
          <stop offset="1" stopColor="#dfa53f" />
        </linearGradient>
      </defs>
      <g transform="rotate(-38 16 16)">
        {[5.5, 16.5].map((y, i) => (
          <g key={y} transform={`translate(${1 + i} ${y})`}>
            <path
              d="M7.5 0 H27 Q28 0 27.6 1 L24.4 8 Q24 9 23 9 H3.5 Q2.5 9 2.9 8 L6.1 1 Q6.5 0 7.5 0 Z"
              fill={`url(#${id})`}
              stroke="#c48a2c"
              strokeWidth="0.7"
            />
            <path
              d="M11 1.2 L8.2 7.8 M15 1.2 L12.2 7.8 M19 1.2 L16.2 7.8 M23 1.2 L20.2 7.8"
              stroke="#e0a948"
              strokeWidth="0.9"
              strokeLinecap="round"
              opacity="0.8"
            />
            <ellipse cx="25.9" cy="4.5" rx="1.9" ry="4" transform="rotate(24 25.9 4.5)" fill="#fbe2a4" stroke="#c48a2c" strokeWidth="0.6" />
            <ellipse cx="25.9" cy="4.5" rx="1.1" ry="2.9" transform="rotate(24 25.9 4.5)" fill="#a8721f" />
          </g>
        ))}
      </g>
    </svg>
  );
}

// Each icon is drawn 20% bigger than the text size the caller gives (text-sm, text-base...).
const ICON = "text-[1.2em]";

// A small picture for the meal's main starch, rice whenever the meal has rice, and beans when it has pulses.
const STARCH_ICON: Record<Exclude<Starch, "pasta" | "rice">, string> = { potatoes: "🥔", noodles: "🍜", bread: "🍞" };

export function FoodIcons({
  starch,
  isPasta,
  isPulse,
  hasRice,
  className,
}: {
  starch: Starch | null;
  isPasta?: boolean;
  isPulse?: boolean;
  hasRice?: boolean;
  className?: string;
}) {
  const { t } = useLang();
  const s = isPasta ? "pasta" : starch;
  const rice = hasRice || s === "rice";
  const main = s === "rice" ? null : s;
  if (!main && !rice && !isPulse) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 leading-none", className)}>
      {main && (
        <span role="img" className={ICON} aria-label={t.starch[main]} title={t.starch[main]}>
          {main === "pasta" ? <PlainPasta /> : STARCH_ICON[main]}
        </span>
      )}
      {rice && (
        <span role="img" className={ICON} aria-label={t.starch.rice} title={t.starch.rice}>
          🍚
        </span>
      )}
      {isPulse && (
        <span role="img" className={ICON} aria-label={t.board.pulses} title={t.board.pulses}>
          🫘
        </span>
      )}
    </span>
  );
}
