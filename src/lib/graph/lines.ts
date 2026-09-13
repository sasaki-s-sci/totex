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

// Lines drawn the same way become one path; a named line stays whole because
// its text is set along it. Hit testing is by grid cell, not by path.

const INDEX_CELL = COMMIT_STEP;

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / INDEX_CELL.x)},${Math.floor(y / INDEX_CELL.y)}`;
}

export function foldCell(at: Point): string {
  return cellKey(at.x, at.y);
}

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

    if (!fold || fold.hides <= 0) return;
    const run = samplesOf(fold.from, fold.to, fold.shape);
    const target: FoldTarget = {
      run,
      at: midpointOf(fold.from, fold.to, fold.shape),
      keep: fold.keep,
      hides: fold.hides,
    };
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

function strokeKey(stroke: StrokeStyle): string {
  return `${stroke.colour}|${stroke.width}|${stroke.opacity}|${stroke.dash ?? ""}`;
}

// Sampled along each piece: a line crossing a cell without stopping in it still answers there.
function cellsOf(run: readonly number[]): Set<string> {
  const cells = new Set<string>();
  for (let index = 0; index + 3 < run.length; index += 2) {
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

const DOT_CLEARANCE = 28;
// The head ring is drawn over the line, so the name stops short of it.
const HEAD_CLEARANCE = 22;
// Rough advance per character; measuring in the browser would cost a reflow per branch.
const NARROW = 3.3;
const WIDE = 6;

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
    // Measured on the chord, which is shorter than the curve, so this errs towards more room.
    at: span > HEAD_CLEARANCE ? 1 - HEAD_CLEARANCE / span : 0,
  };
}

function advanceOf(character: string): number {
  return (character.codePointAt(0) ?? 0) > 0x7f ? WIDE : NARROW;
}
