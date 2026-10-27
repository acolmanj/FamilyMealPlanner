"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { resolveMealImages } from "./actions";

// Fetch photos for meals that have none checked yet, then redraw once they are saved.
export function useResolveImages() {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    void (async () => {
      let changed = false;
      for (let round = 0; round < 8 && !stop; round++) {
        const r = await resolveMealImages().catch(() => null);
        if (!r?.ok) break;
        changed ||= r.updated > 0;
        if (!r.remaining) break;
      }
      if (changed && !stop) router.refresh();
    })();
    return () => {
      stop = true;
    };
  }, [router]);
}
