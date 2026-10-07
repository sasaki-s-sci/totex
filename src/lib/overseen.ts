import type { Report } from "./mcp";

/** A blank line is no line: the card would stand there empty. */
export function overseenReport(status: string | null): Report | null {
  const doing = status?.trim();
  return doing ? { doing, steps: [], overseen: true } : null;
}

/** A reply remains visible while the overseer catches up. Stale summaries cannot replace it. */
export function mergedReports(
  reports: ReadonlyMap<string, Report>,
  summaries: ReadonlyMap<string, Report>,
  active: boolean,
): ReadonlyMap<string, Report> {
  if (!active) return reports;
  const result = new Map(summaries);
  for (const [id, report] of reports) {
    if (!report.reply) continue;
    const summary = summaries.get(id);
    result.set(
      id,
      summary?.replyKey === report.reply.key ? { ...summary, reply: report.reply } : report,
    );
  }
  return result;
}
