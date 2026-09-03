/**
 * The knots between the history and the branch column: where the names that
 * share a start are gathered, and the lines that arrive at each of them.
 *
 * What hangs off a junction is drawn by `drawHeads`, which asks this for where
 * the knot ended up. Which names are gathered at all is `junctions`; this is
 * only where they stand and what runs into them.
 */

import type { PlacedRef } from "../branches";
import type { Point } from "../geometry";
import {
  COMMIT_CELL,
  COMMIT_STEP,
  JUNCTION_TRIM,
  type JunctionFlowNode,
  LINE_COLOR,
  onCommit,
} from "../model";
import { FOLD_DASH, type Frame, sourceOf } from "./frame";

/** How a gathered group is drawn, which is how one of its branches is drawn. */
const GROUP_STROKE = { colour: LINE_COLOR, width: 1.1, opacity: 0.72 };

/**
 * Every knot in one band: where it stands, its mark, and what arrives at it.
 *
 * Placed before anything else in the branch column is drawn, because a branch
 * gathered at one leaves the knot rather than the history — see `drawHeads`.
 *
 * Across, a knot stands in its own column of the grid, one per level of the
 * name it gathers. Down, it takes no row at all: it stands half way between the
 * topmost and bottommost row running through it, which is usually off the
 * lattice everything else is on. That is the point of it — the branch column
 * keeps the rhythm it had, and so do the terminals hanging off it, while the
 * knot sits in the gap the fan leaves. A knot given a row of its own would push
 * a branch down for something that is not a branch.
 */
export function drawJunctions(frame: Frame, refs: readonly PlacedRef[]) {
  const { repository, history, bundle, junctionAt, columnX, drawn, nodes } = frame;
  if (bundle.junctions.length === 0) return;

  // What each knot has to cover: the rows of the branches gathered at it, and
  // the knots gathered at it. Deepest first, so a knot's own children have
  // been placed by the time it asks where they are.
  const covers = new Map<string, number[]>();
  const cover = (id: string, y: number) => {
    const held = covers.get(id);
    if (held) held.push(y);
    else covers.set(id, [y]);
  };
  for (const ref of refs) {
    const over = bundle.parentOf.get(ref.id);
    if (over !== undefined) cover(over, frame.branchLine[ref.row]);
  }

  for (const junction of [...bundle.junctions].reverse()) {
    const held = covers.get(junction.id) ?? [];
    // Half way between the two ends of the fan rather than the average of it:
    // what the knot has to sit in the middle of is the room the lines take,
    // and a group of ten with nine of them on one row would otherwise put the
    // knot on top of those nine.
    const y = (Math.min(...held) + Math.max(...held)) / 2;
    const at: Point = { x: columnX(history.width + junction.column) + COMMIT_STEP.x / 2, y };
    junctionAt.set(junction.id, at);
    if (junction.parent !== null) cover(junction.parent, y);

    nodes.push({
      id: junction.id,
      type: "junction",
      parentId: repository.id,
      extent: "parent",
      position: { x: at.x - COMMIT_STEP.x / 2, y: at.y - COMMIT_STEP.y / 2 },
      data: { prefix: junction.prefix, members: junction.members },
      style: COMMIT_CELL,
      draggable: false,
      selectable: false,
    } satisfies JunctionFlowNode);
  }

  // The outermost knot each one hangs off, worked out once: the junctions are
  // shallowest first, so a parent's own answer is already in here.
  const roots = new Map<string, string>();
  for (const junction of bundle.junctions) {
    const parent = junction.parent;
    roots.set(junction.id, parent === null ? junction.id : (roots.get(parent) ?? parent));
  }

  const arriving = new Map<string, Set<number | null>>();
  for (const ref of refs) {
    const over = bundle.parentOf.get(ref.id);
    const root = over === undefined ? undefined : roots.get(over);
    if (root === undefined) continue;
    const held = arriving.get(root);
    if (held) held.add(ref.from);
    else arriving.set(root, new Set([ref.from]));
  }

  // And what arrives. A knot gathered at another one is a single line from it;
  // one gathered at nothing is the group leaving the history, which is one line
  // per commit any of its branches stands on — the same commit twice is one
  // line, which is the whole saving.
  for (const junction of bundle.junctions) {
    if (junction.parent !== null) {
      drawn.add({
        id: `${junction.id}from`,
        from: onCommit(junction.parent),
        to: onCommit(junction.id),
        shape: "curve",
        trim: JUNCTION_TRIM,
        lead: JUNCTION_TRIM,
        stroke: GROUP_STROKE,
      });
      continue;
    }

    for (const from of arriving.get(junction.id) ?? []) {
      const source = sourceOf(frame, from);
      drawn.add({
        id: `${junction.id}from${from ?? "fold"}`,
        from: source.end,
        to: onCommit(junction.id),
        shape: "curve",
        trim: JUNCTION_TRIM,
        lead: source.lead,
        // The run out of the fold stands for history that is not on screen, and
        // is drawn as the fold's own dash — the fan out of the knot is real and
        // is not.
        stroke: source.folded ? { ...GROUP_STROKE, dash: FOLD_DASH } : GROUP_STROKE,
      });
    }
  }
}
