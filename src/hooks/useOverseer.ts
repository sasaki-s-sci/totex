import { useCallback, useEffect, useMemo, useState } from "react";

import type { Report } from "../lib/mcp";
import { overseenReport } from "../lib/overseen";
import { onOverseer, onStatus, overseerSessions, scopeOf, statusesNow } from "../lib/overseer";
import { onShellExit } from "../lib/pty";
import { watchReadings } from "../lib/watchReadings";

const NOTHING: ReadonlyMap<string, Report> = new Map();
const NONE: readonly string[] = [];

/**
 * Every running overseer's session — one per environment — and their lines on the terminals they
 * cover, already as reports so they can stand in for the agents' own. Each line is built once when
 * it arrives: a card keeps its report while another terminal's line changes.
 */
export function useOverseer() {
  const [sessions, setSessions] = useState<readonly string[]>(NONE);
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
        {
          listen: onOverseer,
          read: () => overseerSessions().then((ids) => [ids]),
          exit: onShellExit,
        },
        setSessions,
        (id) =>
          setSessions((current) =>
            current.includes(id) ? current.filter((other) => other !== id) : current,
          ),
      ),
    [],
  );

  const scopes = useMemo(() => new Set(sessions.map(scopeOf)), [sessions]);
  /** Whether a terminal's environment has an overseer writing its line. */
  const covers = useCallback((id: string) => scopes.has(scopeOf(id)), [scopes]);

  // Lines left by an overseer that is gone would read as current.
  useEffect(() => {
    setStatuses((current) => {
      const kept = [...current].filter(([id]) => covers(id));
      return kept.length === current.size ? current : new Map(kept);
    });
  }, [covers]);

  useEffect(
    () =>
      watchReadings(
        { listen: onStatus, read: statusesNow, exit: onShellExit },
        ({ id, status, replyKey }) => put(id, status, replyKey),
        (id) => put(id, null),
      ),
    [put],
  );

  return { sessions, statuses, covers };
}
