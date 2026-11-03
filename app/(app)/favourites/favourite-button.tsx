"use client";

import { useOptimistic, useTransition } from "react";
import { useLang } from "@/components/lang";
import { cn } from "@/lib/utils";
import { setFavourite } from "./actions";

export function FavouriteButton({ id, name, favourite }: { id: string; name: string; favourite: boolean }) {
  const { t } = useLang();
  const [on, setOn] = useOptimistic(favourite);
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      setOn(!on);
      await setFavourite(id, !on);
    });
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={pending}
        aria-pressed={on}
        aria-label={on ? t.favourites.unmarkLabel(name) : t.favourites.markLabel(name)}
        className={cn(
          "rounded-full px-3.5 py-1.5 text-[13px] font-semibold whitespace-nowrap transition active:scale-95",
          on ? "bg-primary text-primary-foreground shadow-card" : "bg-muted text-primary",
        )}
      >
        {on ? t.favourites.favourite : t.favourites.markFavourite}
      </button>
      {!on && <span className="text-[11px] text-muted-foreground">{t.favourites.awaiting}</span>}
    </div>
  );
}
