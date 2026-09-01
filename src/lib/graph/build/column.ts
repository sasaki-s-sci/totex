/**
 * What a repository's branches hold beside them: one stack of terminals per
 * branch, and the lines back to the rings they hang on.
 */

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
  type Draw,
  type GraphLine,
  onHead,
  onStack,
  SESSION_WIDTH,
  stackReach,
} from "../model";
import { besideMark } from "./cards";
import { cliNode } from "./nodes";
import { take } from "./parts";

/** What a repository's branches hold beside them. */
export type Column = {
  nodes: AppNode[];
  /** The lines joining each branch to its own stack, in band coordinates. */
  lines: GraphLine[];
  /** How far down the band the stacks reach, which the canvas is measured by. */
  bottom: number;
  /**
   * And how far along, which is only ever a question standing beside a mark.
   *
   * The band's own width holds its history and its terminals, and a card is
   * neither: it comes and goes with a question, and the room for it cannot be
   * held open in the band or every repository would carry an empty corridor
   * for a thing that is almost never there.
   */
  right: number;
};

/**
 * One repository's terminals, stacked on the branch each of them is working in.
 *
 * A stack is read downwards: what is running, oldest first — and it is centred
 * on the branch's own line rather than hung under it, so it opens out either
 * way as it grows. A branch running nothing has no stack, because the offer of
 * a terminal is the button on its ring rather than a mark held open out here.
 * The list is packed a `CLI_STEP` at a time rather than a row of the grid
 * apiece — a row is what two lines of development need to be told apart, and
 * terminals are not lines of development — and the layout has already pushed
 * the branches below far enough down to hold it.
 *
 * Built here rather than in the layout because which terminals are running is
 * not history: one opening changes nothing but its own branch's stack, and the
 * repository it belongs to is handed back exactly as it was drawn.
 */
export function bandColumn(
  entry: PreparedRepository,
  open: ReadonlyMap<string, Session[]>,
  /** What another row has already taken, so that nothing is drawn twice. */
  claimed: Set<string>,
  showing: string | null,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
  draw: Draw,
): Column {
  const band = entry.repository.id;
  const drawn: Column = { nodes: [], lines: [], bottom: 0, right: 0 };
  /**
   * How far down the last card in this band reached.
   *
   * Cards stand in one column of their own, to the right of every stack, so two
   * branches asked at once are two cards in the same column — and a card is
   * several times the height of the mark it belongs to. So each one is set
   * beside its own terminal wherever there is room, and pushed down past the
   * last one where there is not: a question that has been shoved down the
   * canvas is still readable, and two drawn over each other are not.
   */
  let floor = Number.NEGATIVE_INFINITY;

  for (const run of entry.runs) {
    const cwd = run.cwd;
    // Two refs can point at one directory — a branch and the worktree it is
    // checked out in — and a directory can be somewhere two repositories both
    // draw. The first claim keeps it; drawing it twice would hand React Flow
    // one id twice.
    const standing = cwd ? take(open, claimed, [cwd]) : [];

    // Where the top of the stack goes: the marks that are running, hung on the
    // branch's own line with half of them above it and half below. A branch is
    // one place and everything running in it is that place's, so the stack
    // opens out from the branch rather than trailing under it — and the layout
    // has made the room either side.
    const head = run.y - stackReach(standing.length);

    // The terminals that are running, oldest first, and nothing else: a branch
    // with none of them draws nothing here.
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
        // Half the glyph it arrives at, so the line stops beside the terminal
        // rather than being drawn across it. There is no paper under the mark
        // to hide a line that went too far.
        trim: CLI_MARK / 2,
        lead: run.lead,
        stroke: CLI_STROKE,
      });

      drawn.bottom = Math.max(drawn.bottom, y + CLI_STEP);

      // And whatever it has standing beside it: the one thing out here that is
      // words rather than a mark.
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

  return drawn;
}

/**
 * The line from a terminal to the question it is standing on.
 *
 * Drawn the same way as the line from the branch to the terminal: this is the
 * same piece of work, one step further along. What it does that the card cannot
 * is say which of a stack of terminals is the one being asked — a card set
 * beside a column of marks belongs to none of them until a line says so.
 */
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
