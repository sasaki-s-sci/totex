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

const GROUP_STROKE = { colour: LINE_COLOR, width: 1.1, opacity: 0.72 };

export function drawJunctions(
  frame: Frame,
  refs: readonly PlacedRef[],
  every: readonly PlacedRef[],
) {
  const { repository, history, bundle, seats, junctionAt, columnX, drawn, nodes } = frame;
  if (bundle.junctions.length === 0) return;

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
  for (const [id, row] of seats) cover(id, frame.branchLine[row]);

  // Deepest first, so a knot's children are placed before it asks where they are.
  for (const junction of [...bundle.junctions].reverse()) {
    const held = covers.get(junction.id) ?? [];

    // Midpoint of the fan, not the average: nine of ten on one row would put the knot on them.
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
      data: { prefix: junction.prefix, members: junction.members, closed: junction.closed },
      style: COMMIT_CELL,
      draggable: false,
      selectable: false,
    } satisfies JunctionFlowNode);
  }

  // Shallowest first, so a parent's answer is already in here.
  const roots = new Map<string, string>();
  for (const junction of bundle.junctions) {
    const parent = junction.parent;
    roots.set(junction.id, parent === null ? junction.id : (roots.get(parent) ?? parent));
  }

  // The same commit twice is one line.
  const arriving = new Map<string, Set<number | null>>();
  for (const ref of every) {
    const over = bundle.parentOf.get(ref.id);
    const root = over === undefined ? undefined : roots.get(over);
    if (root === undefined) continue;
    const held = arriving.get(root);
    if (held) held.add(ref.from);
    else arriving.set(root, new Set([ref.from]));
  }

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

        stroke: source.folded ? { ...GROUP_STROKE, dash: FOLD_DASH } : GROUP_STROKE,
      });
    }
  }
}
