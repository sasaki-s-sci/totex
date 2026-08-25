/**
 * How many repositories a folder holds, asked for a whole listing at once.
 */

import { startTransition, useEffect, useRef, useState } from "react";
import { repositoryCounts } from "./api";

/**
 * How many repositories each of `paths` holds, as far as the backend has been
 * asked.
 *
 * Nothing turns on this but the number on the graph mark — every folder can be
 * put on the graph, repository or not — so it is read for what it says rather
 * than for what it allows.
 *
 * Empty until the answer comes back, so the numbers appear rather than
 * disappearing: the walk behind them takes a moment on a folder that has none,
 * and a mark that shows and then goes away reads as something having gone
 * wrong.
 */
export function useRepositoryCounts(paths: readonly string[]): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(EMPTY);
  /** What has already been sent out, so that scrolling only asks about rows
   *  that have just appeared. */
  const asked = useRef(new Set<string>());
  // The paths themselves are what the answer depends on; the array they arrive
  // in is rebuilt on every render.
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
        // The answers are kept together rather than replaced: they arrive a
        // chunk of rows at a time, and a map rebuilt from the last chunk would
        // take the numbers off every row above it.
        startTransition(() => setCounts((held) => new Map([...held, ...entries])));
      })
      .catch(() => {
        // A folder whose answer never came is asked about again the next time
        // its listing is read.
        for (const path of wanted) asked.current.delete(path);
      });

    return () => {
      cancelled = true;
      // Strict Mode replays a newly mounted effect. An unanswered request must
      // become askable again for the replay rather than being left as checked
      // when its result is deliberately ignored by this cleanup.
      if (!settled) {
        for (const path of wanted) asked.current.delete(path);
      }
    };
  }, [key]);

  return counts;
}

const EMPTY: ReadonlyMap<string, number> = new Map();
