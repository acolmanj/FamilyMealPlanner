import { describe, expect, it } from "vitest";
import { startsAtEdge, swipeAxis, swipeTurn } from "../lib/planner/swipe";

const from = { x: 200, y: 300 };

describe("swipe to change week", () => {
  it("waits until the finger has moved enough", () => {
    expect(swipeAxis(from, { x: 205, y: 303 })).toBeNull();
  });
  it("tells a sideways swipe from a scroll", () => {
    expect(swipeAxis(from, { x: 170, y: 305 })).toBe("side");
    expect(swipeAxis(from, { x: 205, y: 340 })).toBe("scroll");
  });
  it("treats a diagonal move as a scroll", () => {
    expect(swipeAxis(from, { x: 180, y: 318 })).toBe("scroll");
  });
  it("swipe left is next week, swipe right is the week before", () => {
    expect(swipeTurn(from, { x: 100, y: 310 })).toBe("next");
    expect(swipeTurn(from, { x: 300, y: 290 })).toBe("prev");
  });
  it("ignores a swipe that is too short", () => {
    expect(swipeTurn(from, { x: 160, y: 300 })).toBeNull();
  });
  it("ignores a swipe that ends up mostly up or down", () => {
    expect(swipeTurn(from, { x: 120, y: 400 })).toBeNull();
  });
  it("leaves the screen edges to the browser", () => {
    expect(startsAtEdge(10, 390)).toBe(true);
    expect(startsAtEdge(380, 390)).toBe(true);
    expect(startsAtEdge(200, 390)).toBe(false);
  });
});
