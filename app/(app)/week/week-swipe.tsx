"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { startsAtEdge, swipeAxis, swipeTurn, type SwipePoint } from "@/lib/planner/swipe";

// Swipe left for next week, right for the week before: the same as the two arrows.
// Scrolling up and down, taps, and press-and-hold drags are left alone, and nothing
// happens while a pop-up is open (the board marks itself with data-swipe-lock).
export function WeekSwipe({ prevHref, nextHref, children }: { prevHref: string; nextHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const [loading, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const touch = useRef<{ id: number; start: SwipePoint; side: boolean } | null>(null);

  // Have both weeks ready so the swipe feels quick.
  useEffect(() => {
    router.prefetch(prevHref);
    router.prefetch(nextHref);
  }, [router, prevHref, nextHref]);

  const locked = () => Boolean(root.current?.querySelector("[data-swipe-lock]"));
  const find = (list: React.TouchList, id: number) => Array.from(list).find((t) => t.identifier === id);

  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = null;
    if (e.touches.length !== 1 || loading || locked()) return;
    const t = e.touches[0];
    if (startsAtEdge(t.clientX, window.innerWidth)) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    touch.current = { id: t.identifier, start: { x: t.clientX, y: t.clientY }, side: false };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const cur = touch.current;
    if (!cur) return;
    const t = find(e.touches, cur.id);
    // A second finger (pinch), or a meal picked up by press-and-hold: not a swipe.
    if (!t || e.touches.length !== 1 || locked()) {
      touch.current = null;
      return;
    }
    if (cur.side) return;
    const axis = swipeAxis(cur.start, { x: t.clientX, y: t.clientY });
    if (axis === "scroll") touch.current = null;
    else if (axis === "side") cur.side = true;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const cur = touch.current;
    touch.current = null;
    if (!cur?.side || locked()) return;
    const t = find(e.changedTouches, cur.id);
    if (!t) return;
    const turn = swipeTurn(cur.start, { x: t.clientX, y: t.clientY });
    if (!turn) return;
    startTransition(() => router.push(turn === "next" ? nextHref : prevHref));
  };

  return (
    <div
      ref={root}
      data-loading={loading ? "" : undefined}
      className="group/swipe flex touch-pan-y flex-col gap-3"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => (touch.current = null)}
    >
      {children}
    </div>
  );
}
