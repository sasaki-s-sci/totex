import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import { onReport, type Report, reportsNow } from "../lib/mcp";
import { EXIT_EVENT } from "../lib/pty";

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

  useEffect(() => {
    let alive = true;

    const listening = onReport(({ id, report }) => {
      if (alive) put(id, report);
    });
    // A session that has ended is not working on anything, and the report it
    // left behind is a claim about a process that no longer exists. The other
    // side drops it too — this is the window not waiting to be told.
    const finished = listen<string>(EXIT_EVENT, (event) => {
      if (alive) put(event.payload, null);
    });

    reportsNow()
      .then((standing) => {
        if (!alive) return;
        for (const { id, report } of standing) put(id, report);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
      void listening.then((off) => off()).catch(() => undefined);
      void finished.then((off) => off()).catch(() => undefined);
    };
  }, [put]);

  return reports;
}
