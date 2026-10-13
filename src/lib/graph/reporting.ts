import type { Node } from "@xyflow/react";

import type { Report } from "../mcp";
import type { Session } from "../session";
import { clamp, wrap } from "./asking";

// The same card shape as a question, never both at once; measured before
// placement for the same reason. Numbers pair with rules in the stylesheet.
const PAD = 9;
const HEAD = 15;
const SPLIT = 7;
const DOING_LINE = 15;
const STEP_LINE = 14;
const BORDER = 2;

// Terminal columns, not pixels. A step is narrower because its mark stands in front.
const DOING_CELLS = 36;
const STEP_CELLS = 32;

const DOING_LINES = 3;
const STEP_ROWS = 4;

export type CardStep = {
  /** Index in the whole plan: titles can repeat, and the drawn window slides. */
  at: number;
  title: string;
  done: boolean;
  here: boolean;
};

export type ReportCard = {
  doing: string[];
  steps: CardStep[];
  count: string | null;
  height: number;
};

export type ReportNodeData = {
  session: Session;
  report: Report;
  card: ReportCard;
};

export type ReportFlowNode = Node<ReportNodeData, "report">;

export function reportCard(report: Report): ReportCard {
  const doing = clamp(wrap(report.doing, DOING_CELLS), DOING_LINES);

  const working = report.steps.findIndex((step) => !step.done);
  const first = from(report);
  const steps = report.steps.slice(first, first + STEP_ROWS).map((step, at) => ({
    at: first + at,
    title: clamp(wrap(step.title, STEP_CELLS), 1)[0] ?? "",
    done: step.done,
    here: first + at === working,
  }));

  const done = report.steps.filter((step) => step.done).length;
  const count = report.steps.length > 0 ? `${done}/${report.steps.length}` : null;

  let height = BORDER + PAD + HEAD + PAD;
  if (doing.length > 0) height += SPLIT + doing.length * DOING_LINE;
  if (steps.length > 0) height += SPLIT + steps.length * STEP_LINE;

  return { doing, steps, count, height };
}

// The window starts one step before the one in hand.
function from(report: Report): number {
  if (report.steps.length <= STEP_ROWS) return 0;
  const working = report.steps.findIndex((step) => !step.done);
  if (working < 0) return report.steps.length - STEP_ROWS;
  return Math.min(Math.max(working - 1, 0), report.steps.length - STEP_ROWS);
}
