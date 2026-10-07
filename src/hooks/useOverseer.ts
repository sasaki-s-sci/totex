import { useCallback, useEffect, useState } from "react";

import type { Report } from "../lib/mcp";
import { overseenReport } from "../lib/overseen";
import { onOverseer, onStatus, overseerNow, statusesNow } from "../lib/overseer";
import { onShellExit } from "../lib/pty";
import { watchReadings } from "../lib/watchReadings";

const NOTHING: ReadonlyMap<string, Report> = new Map();

/**
 * The overseer's session, and its line on every other terminal, already as reports so they can
 * stand in for the agents' own. Each line is built once when it arrives: a card keeps its report
 * while another terminal's line changes.
 */
export function useOverseer() {
  const [session, setSession] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ReadonlyMap<string, Report>>(NOTHING);

  const put = useCallback((id: string, status: string | null, replyKey?: string | null) => {
    setStatuses((current) => {
      const line = overseenReport(status);
      const report = line ? { ...line, replyKey: replyKey ?? undefined } : null;
      if (
        current.get(id)?.doing === report?.doing &&
        current.get(id)?.replyKey === report?.replyKey
      )
        return current;
      const next = new Map(current);
      if (report) next.set(id, report);
      else if (!next.delete(id)) return current;
      return next;
    });
  }, []);

  useEffect(
    () =>
      watchReadings(
        { listen: onOverseer, read: () => overseerNow().then((id) => [id]), exit: onShellExit },
        setSession,
        (id) => setSession((current) => (current === id ? null : current)),
      ),
    [],
  );

  // Lines left by an overseer that is gone would read as current.
  useEffect(() => {
    if (session === null) setStatuses(NOTHING);
  }, [session]);

  useEffect(
    () =>
      watchReadings(
        { listen: onStatus, read: statusesNow, exit: onShellExit },
        ({ id, status, replyKey }) => put(id, status, replyKey),
        (id) => put(id, null),
      ),
    [put],
  );

  return { session, statuses };
}
