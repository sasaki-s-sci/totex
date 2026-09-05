import { useEffect, useMemo, useState } from "react";
import type { CliTyped } from "../components/cliTyped";
import type { Ask } from "../lib/ask";
import type { Report } from "../lib/mcp";
import { pollVisible } from "../lib/pollVisible";
import { useShowingSaid } from "../lib/said";
import { typedNow } from "../lib/typed";

/** Keep visible labels current, with faster reads while a terminal is open. */
export function useCliTyped(
  /** Whether Ctrl is down, which is one of the two things that puts these on
   *  the marks. The other is the choice in settings, read here. */
  holding: boolean,
  showing: string | null,
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
    return pollVisible(
      typedNow,
      (lines) => {
        const next = new Map(lines.map((line) => [line.id, line.said]));
        setSaid((current) =>
          current?.size === next.size && [...next].every(([id, text]) => current.get(id) === text)
            ? current
            : next,
        );
      },
      showing !== null || holding ? 100 : 1000,
    );
  }, [holding, kept, showing]);

  return useMemo(() => {
    if (!said) return null;
    const lines = new Map<string, string>();
    for (const [session, line] of said) {
      if (!asks.has(session) && !reports.has(session)) lines.set(session, line);
    }
    return lines;
  }, [said, asks, reports]);
}
