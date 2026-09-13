import { startTransition, useEffect, useRef, useState } from "react";
import { repositoryCounts } from "../../folder/api";

/** Empty until the answer comes back, so numbers appear rather than disappear. */
export function useRepositoryCounts(paths: readonly string[]): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(EMPTY);
  const asked = useRef(new Set<string>());
  // By value: the array is rebuilt each render.
  const key = paths.join("\n");

  useEffect(() => {
    const wanted = (key ? key.split("\n") : []).filter((path) => !asked.current.has(path));
    if (wanted.length === 0) return;
    for (const path of wanted) asked.current.add(path);

    let cancelled = false;
    let settled = false;
    repositoryCounts(wanted)
      .then((found) => {
        if (cancelled) return;
        settled = true;
        const entries = Object.entries(found);
        if (entries.length === 0) return;
        // Merged, not replaced: answers arrive a chunk of rows at a time.
        startTransition(() => setCounts((held) => new Map([...held, ...entries])));
      })
      .catch(() => {
        // A folder whose answer never came is asked again on the next read.
        for (const path of wanted) asked.current.delete(path);
      });

    return () => {
      cancelled = true;
      // Strict Mode replays a mounted effect: an unanswered request must become askable again.
      if (!settled) {
        for (const path of wanted) asked.current.delete(path);
      }
    };
  }, [key]);

  return counts;
}

const EMPTY: ReadonlyMap<string, number> = new Map();
