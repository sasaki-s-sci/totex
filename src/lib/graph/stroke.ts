import type { LineShape } from "./geometry";
import { COLUMN_WIDTH, COMMIT_STEP, LANE_HEIGHT, LINE_COLOR } from "./grid";
import { CLI_STEP, SESSION_WIDTH } from "./stacks";

export type GraphLine = {
  id: string;
  from: LineEnd;
  to: LineEnd;
  shape: LineShape;
  /** How far short of the far end to stop, for a line into a ring. */
  trim: number;
  /** How far out from the near end to start, for a line leaving a box. */
  lead: number;
  /** Perpendicular screen-space separation for otherwise coincident lines. */
  offset?: number;
  stroke: StrokeStyle;
  name?: Label;
};

/** Ends are named by node plus a half-box offset, so they follow the mark. */
export type LineEnd = {
  node: string;
  dx: number;
  dy: number;
};

export function onCell(node: string): LineEnd {
  return { node, dx: COLUMN_WIDTH / 2, dy: LANE_HEIGHT / 2 };
}

export function onCommit(node: string): LineEnd {
  return { node, dx: COMMIT_STEP.x / 2, dy: COMMIT_STEP.y / 2 };
}

export function onHead(node: string): LineEnd {
  return { node, dx: COMMIT_STEP.x / 2, dy: COMMIT_STEP.y / 2 };
}

/** A point in a band's own coordinates; a row is a height, not a node. */
export function inBand(band: string, x: number, y: number): LineEnd {
  return { node: band, dx: x, dy: y };
}

export function onStack(node: string): LineEnd {
  return { node, dx: SESSION_WIDTH / 2, dy: CLI_STEP / 2 };
}

export type Label = {
  full: string;
  /** As much of the name as the line has room for. */
  text: string;
  note: string | null;
  /** Fraction along the line. */
  at: number;
};

/** Lines with equal styles are drawn as one path. */
export type StrokeStyle = {
  colour: string;
  width: number;
  opacity: number;
  dash?: string;
};

export const CLI_STROKE: StrokeStyle = {
  colour: "var(--mui-palette-text-disabled)",
  width: 1.0,
  opacity: 0.7,
};

/** A line to a terminal that is not there yet: the terminal's own stroke, dashed as its mark is. */
export const OFFER_STROKE: StrokeStyle = { ...CLI_STROKE, dash: "3 4" };

export const FOLDER_STROKE: StrokeStyle = {
  colour: LINE_COLOR,
  width: 1.0,
  opacity: 0.45,
};
