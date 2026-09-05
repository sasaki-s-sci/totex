import { useCallback, useEffect, useState } from "react";

import { onReport, type Report, reportsNow } from "../lib/mcp";
import { onShellExit } from "../lib/pty";
import { watchReadings } from "../lib/watchReadings";

/** Nothing is saying anything, which is the ordinary state of the machine. */
const NOTHING: ReadonlyMap<string, Report> = new Map();

/**
 * What every running session says it is working on, kept current.
 *
 * Keyed by session, because that is what the graph draws the card beside. A
 * session that has said nothing is not in here at all — which is every session
 * until somebody has registered the server with their agent, and every session
 * running something that is not an agent for as long as this app exists.
 *
 * Nothing is held back here the way a question is. A question is read off a
 * screen that is redrawn in frames, so a reading has to be given a moment to
 * turn out to be real; a report is a sentence somebody sent on purpose, and
 * there is no such thing as half of one.
 */
export function useReports() {
  const [reports, setReports] = useState<ReadonlyMap<string, Report>>(NOTHING);

  const put = useCallback((id: string, report: Report | null) => {
    setReports((current) => {
      const next = new Map(current);
      if (report) next.set(id, report);
      else if (!next.delete(id)) return current;
      return next;
    });
  }, []);

  useEffect(
    () =>
      watchReadings(
        { listen: onReport, read: reportsNow, exit: onShellExit },
        ({ id, report }) => put(id, report),
        (id) => put(id, null),
      ),
    [put],
  );

  return reports;
}
