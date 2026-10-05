import { useEffect, useMemo, useState } from "react";
import type { Ask } from "../../lib/ask";
import type { Report } from "../../lib/mcp";
import { pollVisible } from "../../lib/pollVisible";
import { useShowingSaid } from "../../lib/said";
import { typedNow } from "../../lib/typed";
import type { CliTyped } from "../cliTyped";

export function useCliTyped(
  showing: string | null,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
  overseen: boolean,
): CliTyped {
  const kept = useShowingSaid();
  const [said, setSaid] = useState<CliTyped>(null);

  useEffect(() => {
    // The overseer's line says what was typed when it matters, in its words.
    if (overseen || !kept) {
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
      showing !== null ? 100 : 1000,
    );
  }, [kept, showing, overseen]);

  return useMemo(() => {
    if (!said) return null;
    const lines = new Map<string, string>();
    for (const [session, line] of said) {
      if (!asks.has(session) && !reports.has(session)) lines.set(session, line);
    }
    return lines;
  }, [said, asks, reports]);
}
