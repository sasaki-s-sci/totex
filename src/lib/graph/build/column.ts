import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import { ordinalOf, type Session } from "../../session";
import { ASK_GAP, ASK_STACK_GAP } from "../asking";
import type { PreparedRepository } from "../layout";
import {
  type AppNode,
  CLI_MARK,
  CLI_STEP,
  CLI_STROKE,
  COMMIT_STEP,
  type Draw,
  type GraphLine,
  inBand,
  OFFER_STROKE,
  type OfferFlowNode,
  onHead,
  onStack,
  SESSION_WIDTH,
  stackReach,
} from "../model";
import { besideMark } from "./cards";
import { cliNode, offerNode } from "./nodes";
import { take } from "./parts";

export type Column = {
  nodes: AppNode[];

  offers: OfferFlowNode[];

  lines: GraphLine[];

  /** Lines into `offers`, kept apart from `lines`: they are drawn only while the offers are. */
  offerLines: GraphLine[];

  bottom: number;

  right: number;
};

/** The air between the topmost stack and the new workspace over it. */
const NEW_RISE = (COMMIT_STEP.y - CLI_STEP) / 2;

export function bandColumn(
  entry: PreparedRepository,
  open: ReadonlyMap<string, Session[]>,

  claimed: Set<string>,
  showing: string | null,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
  draw: Draw,
): Column {
  const band = entry.repository.id;
  const drawn: Column = { nodes: [], offers: [], lines: [], offerLines: [], bottom: 0, right: 0 };

  let floor = Number.NEGATIVE_INFINITY;

  // Where the topmost stack begins; a band with no branch has only its own top.
  let ceiling = entry.runs.length === 0 ? 0 : Number.POSITIVE_INFINITY;

  for (const run of entry.runs) {
    const cwd = run.cwd;

    // A branch and its worktree, or two repositories, can share a directory; the first claim draws it.
    const standing = cwd ? take(open, claimed, [cwd]) : [];

    // Nothing runs here. A directory whose terminals another row claimed is not empty.
    if (!cwd || !open.has(cwd)) {
      drawn.offers.push(
        offerNode(
          `offer${run.head}`,
          { kind: "open", repository: entry.repository, branch: run.branch, cwd },
          band,
          run.x,
          run.y,
          draw,
        ),
      );
    }

    // Centred on the branch line; the layout made room either side.
    const head = run.y - stackReach(standing.length);
    // An empty row still holds the box its offer stands in.
    ceiling = Math.min(ceiling, Math.min(head, run.y));

    for (const [slot, session] of standing.entries()) {
      const id = `session${session.id}`;
      const y = head + slot * CLI_STEP;

      drawn.nodes.push(
        cliNode(
          id,
          {
            session,
            showing: session.id === showing,
            ordinal: ordinalOf(open.get(session.cwd) ?? [], session),
            group: band,
          },
          band,
          run.x,
          y,
          draw,
        ),
      );

      drawn.lines.push({
        id: `${id}run`,
        from: onHead(run.head),
        to: onStack(id),
        shape: "curve",

        // Half the glyph, so the line stops beside the terminal rather than across it.
        trim: CLI_MARK / 2,
        lead: run.lead,
        stroke: CLI_STROKE,
      });

      drawn.bottom = Math.max(drawn.bottom, y + CLI_STEP);

      const x = run.x + SESSION_WIDTH + ASK_GAP;
      const beside = besideMark(session, asks, reports, id, band, x, y, floor, draw);
      if (!beside) continue;

      floor = beside.at + beside.height + ASK_STACK_GAP;
      drawn.nodes.push(beside.node);
      drawn.lines.push(beside.line);

      drawn.bottom = Math.max(drawn.bottom, beside.at + beside.height);
      drawn.right = Math.max(drawn.right, x + beside.width);
    }
  }

  // The new workspace heads the column, over every branch there is, and leaves the default
  // branch's ring, which stands on its latest commit: the corridor beside the rings is the lines'.
  const column = entry.runs[0]?.x ?? entry.style.width - SESSION_WIDTH;
  const rise = ceiling - NEW_RISE - CLI_STEP;
  drawn.offers.push(
    offerNode(
      `offer${band}new`,
      { kind: "new", repository: entry.repository },
      band,
      column,
      rise,
      draw,
    ),
  );

  const main = entry.repository.defaultBranch?.replace(/^refs\/heads\//, "");
  const from = entry.runs.find((run) => run.branch === main) ?? entry.runs[0];
  if (from) {
    drawn.offerLines.push({
      id: `offer${band}newline`,
      from: onHead(from.head),
      to: inBand(band, column + SESSION_WIDTH / 2, rise + CLI_STEP / 2),
      shape: "curve",
      trim: CLI_MARK / 2,
      lead: from.lead,
      stroke: OFFER_STROKE,
    });
  }

  return drawn;
}

export function cardLine(card: string, mark: string, height: number): GraphLine {
  return {
    id: `${card}line`,
    from: onStack(mark),
    to: { node: card, dx: 0, dy: height / 2 },
    shape: "curve",
    trim: 0,
    lead: CLI_MARK / 2,
    stroke: CLI_STROKE,
  };
}
