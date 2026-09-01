import { type LineShape, midpointOf, type Point, samplesOf } from "./geometry";
import {
  type BandLines,
  COMMIT_STEP,
  type CommitFlowNode,
  type FoldTarget,
  type GraphLine,
  type Label,
  type StrokeStyle,
} from "./model";

/**
 * The lines a band draws, collected as they are worked out and batched at the
 * end.
 *
 * Lines drawn the same way become one path: the canvas is thousands of lines
 * and a handful of ways of drawing one, so what the engine is handed is a
 * handful of elements rather than one per commit. A line carrying a name is
 * kept whole, because the name is set along that line and needs a path of its
 * own to be set along.
 *
 * What the pointer is over is answered here too, and by arithmetic rather than
 * by hit-testing a thousand paths: the graph is a grid, so the cell under the
 * cursor is a division, and every line answers in the cells it passes through.
 */

/**
 * How wide a cell of that index is: one commit's own cell.
 *
 * So a cell holds at most one commit's mark and the handful of lines that pass
 * through it, and the pointer is only ever in one cell.
 */
const INDEX_CELL = COMMIT_STEP;

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / INDEX_CELL.x)},${Math.floor(y / INDEX_CELL.y)}`;
}

/** Which cell of the index a point falls in. */
export function foldCell(at: Point): string {
  return cellKey(at.x, at.y);
}

/** What a line the pointer can fold at needs to know about itself. */
export type Fold = {
  keep: number;
  hides: number;
  from: Point;
  to: Point;
  shape: LineShape;
};

export class Lines {
  private readonly batches = new Map<string, { stroke: StrokeStyle; parts: GraphLine[] }>();
  private readonly named: GraphLine[] = [];
  private readonly folds = new Map<string, FoldTarget[]>();
  private readonly dots = new Map<string, { at: Point; node: CommitFlowNode }>();

  /** A commit's own mark, which the offer of a branch is drawn out of. */
  mark(at: Point, node: CommitFlowNode) {
    this.dots.set(foldCell(at), { at, node });
  }

  add(line: GraphLine, fold?: Fold) {
    if (line.name !== undefined) {
      this.named.push(line);
    } else {
      const key = strokeKey(line.stroke);
      const batch = this.batches.get(key);
      if (batch) batch.parts.push(line);
      else this.batches.set(key, { stroke: line.stroke, parts: [line] });
    }

    // Nothing behind it to fold away: the offer would say "hide zero commits".
    if (!fold || fold.hides <= 0) return;
    const run = samplesOf(fold.from, fold.to, fold.shape);
    const target: FoldTarget = {
      run,
      at: midpointOf(fold.from, fold.to, fold.shape),
      keep: fold.keep,
      hides: fold.hides,
    };
    // Every cell the line passes through answers for it, so the pointer finds
    // it wherever along the line it lands.
    for (const key of cellsOf(run)) {
      const held = this.folds.get(key);
      if (held) held.push(target);
      else this.folds.set(key, [target]);
    }
  }

  done(): BandLines {
    const strokes = [...this.batches].map(([key, batch]) => ({
      key,
      stroke: batch.stroke,
      parts: batch.parts,
    }));
    return {
      strokes,
      named: this.named,
      folds: this.folds,
      dots: this.dots,
    };
  }
}

/** Two lines drawn this way are one path. */
function strokeKey(stroke: StrokeStyle): string {
  return `${stroke.colour}|${stroke.width}|${stroke.opacity}|${stroke.dash ?? ""}`;
}

/** Every cell of the index a run of points passes through. */
function cellsOf(run: readonly number[]): Set<string> {
  const cells = new Set<string>();
  for (let index = 0; index + 3 < run.length; index += 2) {
    // Along the piece rather than at its ends: a line crossing a cell without
    // stopping in it still has to answer there.
    const steps = Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(run[index + 2] - run[index]) / INDEX_CELL.x,
          Math.abs(run[index + 3] - run[index + 1]) / INDEX_CELL.y,
        ),
      ),
    );
    for (let step = 0; step <= steps; step++) {
      const at = step / steps;
      cells.add(
        cellKey(
          run[index] + (run[index + 2] - run[index]) * at,
          run[index + 1] + (run[index + 3] - run[index + 1]) * at,
        ),
      );
    }
  }
  return cells;
}

/** Room left at the commit end of a branch line, for its dot. */
const DOT_CLEARANCE = 28;
/**
 * Room left at the head end.
 *
 * The head is a ring with a ring of canvas around it, and it is drawn over the
 * line rather than behind it — so a name that runs all the way to the end loses
 * its last letter or two under it. This is what keeps the name back on the near
 * side of the head, where it can be read whole.
 */
const HEAD_CLEARANCE = 22;
/** Rough advance per character at the name's size, wide characters apart. */
const NARROW = 3.3;
const WIDE = 6;

/**
 * A branch's name, cut to what its own line has room for, with what the branch
 * is to the repository set on a line of its own above it.
 *
 * Measured by eye rather than by the browser: laying the text out to find its
 * width would cost a reflow per branch, and being a character out only moves
 * where a name that was going to be cut short gets cut.
 *
 * The note is off the name's line rather than after it, so the two never share
 * the one stretch of curve: the name keeps the whole of the room, and the note
 * — the shorter half, and the one that says something the name cannot — is
 * never cut to make space for it.
 */
export function labelOf(name: string, note: string | null, from: Point, to: Point): Label {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const room = span - DOT_CLEARANCE - HEAD_CLEARANCE;

  let width = 0;
  let kept = "";
  let text = name;
  for (const character of name) {
    width += advanceOf(character);
    if (width > room) {
      text = `${kept}…`;
      break;
    }
    kept += character;
  }

  return {
    full: note === null ? name : `${name} (${note})`,
    text,
    note,
    // Set against the far end, where the curve has flattened out, and stopped
    // short of the head so the ring cannot cover the last letters. The straight
    // run stands in for the curve's own length, which is the longer of the two —
    // so this errs towards leaving more room, not less.
    at: span > HEAD_CLEARANCE ? 1 - HEAD_CLEARANCE / span : 0,
  };
}

/** Rough advance of one character at the name's size. */
function advanceOf(character: string): number {
  return (character.codePointAt(0) ?? 0) > 0x7f ? WIDE : NARROW;
}
