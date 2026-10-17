import { useEffect, useMemo, useState } from "react";
import type { Report } from "../../lib/mcp";
import { pollVisible } from "../../lib/pollVisible";
import { useShowingSaid } from "../../lib/said";
import { typedNow } from "../../lib/typed";
import type { CliTyped } from "../cliTyped";

export function useCliTyped(
  showing: string | null,
  reports: ReadonlyMap<string, Report>,
): CliTyped {
  const kept = useShowingSaid();
  const [said, setSaid] = useState<CliTyped>(null);

  useEffect(() => {
    if (!kept) {
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
  }, [kept, showing]);

  return useMemo(() => {
    if (!said) return null;
    const lines = new Map<string, string>();
    for (const [session, line] of said) {
      if (!reports.has(session)) lines.set(session, line);
    }
    return lines;
  }, [said, reports]);
}
