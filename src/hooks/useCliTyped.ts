import { useEffect, useMemo, useState } from "react";
import type { CliTyped } from "../components/cliTyped";
import type { Ask } from "../lib/ask";
import type { Report } from "../lib/mcp";
import { useShowingSaid } from "../lib/said";
import { typedNow } from "../lib/typed";

/**
 * How often the lines are taken again while they are being kept on rather than
 * held. Long enough that a window left open all day is not asking a hundred
 * times a minute, short enough that a line is never far behind the terminal it
 * is standing beside.
 */
const KEEP_MS = 2000;

/**
 * What each terminal was last told to do, for as long as Ctrl is held — or all
 * the time, where the window has been told to keep them.
 *
 * Asked for at the press rather than kept up to date. What a session says it
 * was last typed at changes with every keystroke somebody makes in it, and a
 * window that followed that would be rebuilding this canvas for every letter
 * typed into a terminal it is not even showing. So it is a reading taken at the
 * moment somebody asks to see it, and it stands until the key is let go — the
 * lines are what is running, glanced at, rather than a thing to watch.
 *
 * Kept on, the same reading is simply taken again on a slow round: still a
 * glance rather than a subscription, and still the window asking rather than
 * the sessions telling. The round stops while the window is not on screen,
 * where there is nobody the answer could be for.
 *
 * A terminal with a card already standing beside it gets none. The card is in
 * that same place and says more than a line could — the question the session
 * stopped to ask, or what it says it is working on — and a line drawn over it
 * would be the canvas talking over itself.
 */
export function useCliTyped(
  /** Whether Ctrl is down, which is one of the two things that puts these on
   *  the marks. The other is the choice in settings, read here. */
  holding: boolean,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
): CliTyped {
  const kept = useShowingSaid();
  const [said, setSaid] = useState<CliTyped>(null);

  useEffect(() => {
    if (!holding && !kept) {
      setSaid(null);
      return;
    }
    // The key can be let go before the answer arrives, and an answer that
    // landed after that would put the lines on a canvas nobody is holding a key
    // over any more.
    let asking = true;
    const read = () => {
      typedNow()
        .then((lines) => {
          if (asking) setSaid(new Map(lines.map((line) => [line.id, line.said])));
        })
        .catch(() => {
          // A window that cannot ask is a window with nothing to draw here,
          // which is what it already has. Nothing about the canvas is wrong for it.
        });
    };
    read();
    if (!kept) {
      return () => {
        asking = false;
      };
    }
    const round = setInterval(() => {
      // Minimised, or behind something: the lines are drawn for an eye running
      // over the canvas, and there is no eye on it.
      if (!document.hidden) read();
    }, KEEP_MS);
    return () => {
      asking = false;
      clearInterval(round);
    };
  }, [holding, kept]);

  return useMemo(() => {
    if (!said) return null;
    const lines = new Map<string, string>();
    for (const [session, line] of said) {
      if (!asks.has(session) && !reports.has(session)) lines.set(session, line);
    }
    return lines;
  }, [said, asks, reports]);
}
