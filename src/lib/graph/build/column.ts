import type { Report } from "../../mcp";
import { ordinalOf, type Session } from "../../session";
import { refNodeId } from "../branches";
import { commitNodeId, newWorkBase } from "../history";
import type { PreparedRepository } from "../layout";
import {
  type AppNode,
  CHIP_STEP,
  CLI_STEP,
  CLI_STROKE,
  COMMIT_TRIM,
  type Draw,
  type GraphLine,
  inBand,
  type LineEnd,
  NEW_RISE,
  OFFER_STROKE,
  type OfferFlowNode,
  onCommit,
  onHead,
  onStack,
  REMOTE_HEAD_TRIM,
  RING_TRIM,
  SESSION_WIDTH,
  stackReach,
} from "../model";
import { REPORT_GAP, REPORT_STACK_GAP } from "../reporting";
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

export function bandColumn(
  entry: PreparedRepository,
  open: ReadonlyMap<string, Session[]>,

  claimed: Set<string>,
  showing: string | null,
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
      drawn.offerLines.push({
        id: `offer${run.head}line`,
        from: onHead(run.head),
        to: inBand(band, run.x + SESSION_WIDTH + REPORT_GAP, run.y + CLI_STEP / 2),
        shape: "curve",
        trim: 0,
        lead: run.lead,
        stroke: OFFER_STROKE,
      });
    }

    // Centred on the branch line; the layout made room either side.
    const head = run.y - stackReach(standing.length);
    // An empty row still holds the box its offer stands in.
    ceiling = Math.min(ceiling, Math.min(head, run.y));

    for (const [slot, session] of standing.entries()) {
      const id = `session${session.id}`;
      const y = head + slot * CLI_STEP;
      const x = run.x + SESSION_WIDTH + REPORT_GAP;
      const beside = besideMark(session, reports, band, x, y, floor, draw);
      // Level with its card's centre, so the one edge reaches the card without a peak.
      const stand = beside ? beside.at + beside.height / 2 - CLI_STEP / 2 : y;

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
          stand,
          draw,
        ),
      );

      drawn.bottom = Math.max(drawn.bottom, stand + CLI_STEP);

      // One edge from the head to the card, as the git graph draws a parent link; the terminal is only its label.
      if (!beside) {
        drawn.lines.push({
          id: `${id}run`,
          from: onHead(run.head),
          to: onStack(id),
          shape: "curve",
          trim: 0,
          lead: run.lead,
          stroke: CLI_STROKE,
        });
        continue;
      }

      floor = beside.at + beside.height + REPORT_STACK_GAP;
      drawn.nodes.push(beside.node);
      drawn.lines.push({
        id: `${id}run`,
        from: onHead(run.head),
        to: { node: beside.node.id, dx: 0, dy: beside.height / 2 },
        shape: "curve",
        trim: 0,
        lead: run.lead,
        stroke: CLI_STROKE,
        terminal: id,
      });

      drawn.bottom = Math.max(drawn.bottom, beside.at + beside.height);
      drawn.right = Math.max(drawn.right, x + beside.width);
    }
  }

  // The new workspace heads the column, over every branch there is. What it draws is a workspace:
  // a ring cut from a commit, with the terminal it opens hanging off it as any branch's does.
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

  // Where a ring would stand in the ring column, level with the terminal it opens.
  const ring = inBand(band, column + SESSION_WIDTH / 2 - CHIP_STEP, rise + CLI_STEP / 2);
  const from = newWorkFrom(entry);
  if (from) {
    drawn.offerLines.push({
      id: `offer${band}newcut`,
      from: from.end,
      to: ring,
      shape: "curve",
      trim: RING_TRIM,
      lead: from.lead,
      stroke: OFFER_STROKE,
    });
  }
  drawn.offerLines.push({
    id: `offer${band}newline`,
    from: ring,
    to: inBand(band, column + SESSION_WIDTH + REPORT_GAP, rise + CLI_STEP / 2),
    shape: "curve",
    trim: 0,
    lead: RING_TRIM,
    stroke: OFFER_STROKE,
  });

  return drawn;
}

// The commit the new workspace is cut from, as `newWork` cuts it; behind the fold, its branch's
// ring stands for it, and under a hidden branch there is nothing drawn to leave from.
function newWorkFrom({ repository, nodes }: PreparedRepository): {
  end: LineEnd;
  lead: number;
} | null {
  const { branch, commit } = newWorkBase(repository);
  const drawn = (id: string) => nodes.some((node) => node.id === id);

  const dot = commit && commitNodeId(repository, commit);
  if (dot && drawn(dot)) return { end: onCommit(dot), lead: COMMIT_TRIM };

  const ring = branch && refNodeId(repository, branch.id);
  if (ring && drawn(ring)) {
    return {
      end: onHead(ring),
      lead: branch.kind === "remote" ? REMOTE_HEAD_TRIM : RING_TRIM,
    };
  }
  return null;
}
