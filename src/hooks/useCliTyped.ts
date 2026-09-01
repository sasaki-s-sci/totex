import { useEffect, useMemo, useState } from "react";
import type { CliTyped } from "../components/cliTyped";
import type { Ask } from "../lib/ask";
import type { Report } from "../lib/mcp";
import { typedNow } from "../lib/typed";

/**
 * What each terminal was last told to do, for as long as Ctrl is held.
 *
 * Asked for at the press rather than kept up to date. What a session says it
 * was last typed at changes with every keystroke somebody makes in it, and a
 * window that followed that would be rebuilding this canvas for every letter
 * typed into a terminal it is not even showing. So it is a reading taken at the
 * moment somebody asks to see it, and it stands until the key is let go — the
 * lines are what is running, glanced at, rather than a thing to watch.
 *
 * A terminal with a card already standing beside it gets none. The card is in
 * that same place and says more than a line could — the question the session
 * stopped to ask, or what it says it is working on — and a line drawn over it
 * would be the canvas talking over itself.
 */
export function useCliTyped(
  /** Whether Ctrl is down, which is the whole of what puts these on the marks. */
  holding: boolean,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
): CliTyped {
  const [said, setSaid] = useState<CliTyped>(null);

  useEffect(() => {
    if (!holding) {
      setSaid(null);
      return;
    }
    // The key can be let go before the answer arrives, and an answer that
    // landed after that would put the lines on a canvas nobody is holding a key
    // over any more.
    let asking = true;
    typedNow()
      .then((lines) => {
        if (asking) setSaid(new Map(lines.map((line) => [line.id, line.said])));
      })
      .catch(() => {
        // A window that cannot ask is a window with nothing to draw here, which
        // is what it already has. Nothing about the canvas is wrong for it.
      });
    return () => {
      asking = false;
    };
  }, [holding]);

  return useMemo(() => {
    if (!said) return null;
    const lines = new Map<string, string>();
    for (const [session, line] of said) {
      if (!asks.has(session) && !reports.has(session)) lines.set(session, line);
    }
    return lines;
  }, [said, asks, reports]);
}
