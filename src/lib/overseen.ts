import type { Report } from "./mcp";

/** A blank line is no line: the card would stand there empty. */
export function overseenReport(status: string | null): Report | null {
  const doing = status?.trim();
  return doing ? { doing, steps: [], overseen: true } : null;
}
