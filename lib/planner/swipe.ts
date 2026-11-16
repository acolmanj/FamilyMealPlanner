// Tells a sideways swipe (change week) apart from a scroll, a tap or a drag.
// Kept free of the DOM so the rules can be tested.

export type SwipePoint = { x: number; y: number };
export type SwipeAxis = "side" | "scroll";
export type SwipeTurn = "next" | "prev";

/** The finger must travel this far before we decide what it is doing. */
export const SWIPE_SLOP = 12;
/** A swipe shorter than this does nothing. */
export const SWIPE_MIN = 64;
/** Touches that start this close to a screen edge belong to the browser (back / forward). */
export const SWIPE_EDGE = 24;

/** Once the finger has moved enough: is it going sideways, or scrolling the page? Null while it is still too early to say. */
export function swipeAxis(start: SwipePoint, now: SwipePoint): SwipeAxis | null {
  const dx = Math.abs(now.x - start.x);
  const dy = Math.abs(now.y - start.y);
  if (Math.max(dx, dy) < SWIPE_SLOP) return null;
  // Clearly more sideways than up and down; anything close to a diagonal counts as a scroll.
  return dx > dy * 1.5 ? "side" : "scroll";
}

/** Where a finished sideways swipe leads. Swiping left brings in the next week, like turning a page. */
export function swipeTurn(start: SwipePoint, end: SwipePoint): SwipeTurn | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "prev";
}

/** Touches that start at the very edge of the screen are left to the browser. */
export function startsAtEdge(x: number, screenWidth: number): boolean {
  return x < SWIPE_EDGE || x > screenWidth - SWIPE_EDGE;
}
