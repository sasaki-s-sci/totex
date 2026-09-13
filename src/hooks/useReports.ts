import { useCallback, useEffect, useState } from "react";

import { onReport, type Report, reportsNow } from "../lib/mcp";
import { onShellExit } from "../lib/pty";
import { watchReadings } from "../lib/watchReadings";

const NOTHING: ReadonlyMap<string, Report> = new Map();

// Not held back like a question: a report is sent on purpose.
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
