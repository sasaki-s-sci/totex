import { startTransition, useEffect, useState } from "react";

import { onRunningChanged, scanRunning, watchRunning } from "../lib/running/api";
import type { Running } from "../types/running";

/** Before the first sweep has come back, which is a moment either way. */
const NOTHING: Running = { agents: [] };

/**
 * Every agent running on this machine, kept current for as long as it is wanted.
 *
 * The sweep is the backend's, and it is started and stopped with `watching`:
 * the panel that shows this is one somebody opens, and a window sitting closed
 * has no reason to be reading the process table all afternoon.
 *
 * The first answer is asked for outright rather than waited for — the sweep
 * only speaks up when something moved, and the first thing it finds is usually
 * the same as the last, so a panel that only listened would open empty.
 */
export function useRunning(watching: boolean) {
  const [running, setRunning] = useState<Running>(NOTHING);

  useEffect(() => {
    if (!watching) return;

    let alive = true;
    // A transition, every time: nothing here was asked for by whoever is at the
    // window, and a sweep landing mid-drag must not be what the drag waits for.
    // What it changes is a chip on a branch row.
    const listening = onRunningChanged((next) => {
      if (alive) startTransition(() => setRunning(next));
    });

    // A sweep that will not run leaves the branch rows as they were. What this
    // draws is a chip beside a branch; there is nothing to say about its
    // absence that the absence does not already say.
    scanRunning()
      .then((next) => {
        if (alive) startTransition(() => setRunning(next));
      })
      .catch(() => undefined);
    void watchRunning(true).catch(() => undefined);

    return () => {
      alive = false;
      void watchRunning(false).catch(() => undefined);
      void listening.then((off) => off()).catch(() => undefined);
    };
  }, [watching]);

  return { running };
}
