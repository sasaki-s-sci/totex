import type { Report } from "./mcp";

/** A blank line is no line: the card would stand there empty. */
export function overseenReport(status: string | null): Report | null {
  const doing = status?.trim();
  return doing ? { doing, steps: [], overseen: true } : null;
}

/**
 * A covered terminal shows its overseer's line in place of its agent's report; any other keeps
 * its own. A reply remains visible while the overseer catches up. Stale summaries cannot replace
 * it.
 */
export function mergedReports(
  reports: ReadonlyMap<string, Report>,
  summaries: ReadonlyMap<string, Report>,
  covers: (id: string) => boolean,
): ReadonlyMap<string, Report> {
  const result = new Map<string, Report>();
  for (const [id, summary] of summaries) if (covers(id)) result.set(id, summary);
  for (const [id, report] of reports) {
    if (!covers(id)) {
      result.set(id, report);
      continue;
    }
    if (!report.reply) continue;
    const summary = summaries.get(id);
    result.set(
      id,
      summary?.replyKey === report.reply.key ? { ...summary, reply: report.reply } : report,
    );
  }
  return result;
}
