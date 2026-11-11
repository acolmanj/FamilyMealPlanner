"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { resolveMealImages } from "./actions";

// The photo lookup in flight, and how many planning actions want the loop to stand aside.
// Server actions run one at a time, so a slow lookup would hold up "Plan week" or Undo,
// and its late answer could redraw the page with the week as it was before.
let running: Promise<unknown> | null = null;
let paused = 0;

export async function withImagesPaused<T>(fn: () => Promise<T>): Promise<T> {
  paused++;
  try {
    await running?.catch(() => null);
    return await fn();
  } finally {
    paused--;
  }
}

// Fetch photos for meals that have none checked yet, then redraw once they are saved.
export function useResolveImages() {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    void (async () => {
      let changed = false;
      for (let round = 0; round < 8 && !stop && !paused; round++) {
        const call = resolveMealImages();
        running = call;
        const r = await call.catch(() => null);
        running = null;
        if (!r?.ok) break;
        changed ||= r.updated > 0;
        if (!r.remaining) break;
      }
      if (changed && !stop && !paused) router.refresh();
    })();
    return () => {
      stop = true;
    };
  }, [router]);
}
