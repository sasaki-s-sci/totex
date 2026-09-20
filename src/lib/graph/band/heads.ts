import type { PlacedRef } from "../branches";
import { type Point, shortOf } from "../geometry";
import { labelOf } from "../lines";
import {
  CLI_STEP,
  COMMIT_STEP,
  HEAD_CELL,
  JUNCTION_TRIM,
  LINE_COLOR,
  onCommit,
  onHead,
  REMOTE_HEAD_TRIM,
  RING_TRIM,
  SESSION_WIDTH,
} from "../model";
import { FOLD_DASH, type Frame, type Source, sourceOf } from "./frame";

export function drawHeads(frame: Frame, refs: readonly PlacedRef[]) {
  const { repository, bundle, junctionAt, branchLine, heads, ring, working, drawn, nodes, runs } =
    frame;

  for (const ref of refs) {
    const at: Point = { x: ring, y: branchLine[ref.row] };

    nodes.push({
      id: ref.id,
      type: "head",
      parentId: repository.id,
      extent: "parent",
      position: { x: heads, y: at.y - COMMIT_STEP.y / 2 },
      data: ref.data,
      style: HEAD_CELL,
      draggable: false,
      selectable: false,
    });

    const headTrim = ref.data.kind === "remote" ? REMOTE_HEAD_TRIM : RING_TRIM;
    const gathered = bundle.parentOf.get(ref.id);
    const knot = gathered === undefined ? undefined : junctionAt.get(gathered);
    const source: Source =
      gathered !== undefined && knot !== undefined
        ? { end: onCommit(gathered), at: knot, lead: JUNCTION_TRIM, folded: false }
        : sourceOf(frame, ref.from);
    const leaves = shortOf(at, source.at, source.lead, "curve");
    const reaches = shortOf(source.at, at, headTrim, "curve");
    drawn.add({
      id: `${ref.id}branch`,
      from: source.end,
      to: onHead(ref.id),
      shape: "curve",
      trim: headTrim,
      lead: source.lead,

      // Two refs at one commit: dashed remote track above, solid local track below.
      offset: ref.data.together ? (ref.data.kind === "remote" ? -0.8 : 0.8) : undefined,
      stroke: {
        colour: LINE_COLOR,
        width: 1.1,
        opacity: 0.72,

        // Remote, or behind the fold: the run is not on screen.
        dash: ref.data.kind === "remote" || source.folded ? FOLD_DASH : undefined,
      },

      name:
        // A synchronized remote hides its duplicate name until the refs diverge.
        ref.data.kind === "remote" && ref.data.together
          ? undefined
          : labelOf(ref.data.name, ref.note, leaves, reaches),
    });

    // Room for the stack is made here because it pushes neighbouring branches; `build` fills it.
    if (ref.data.kind !== "remote") {
      runs.push({
        head: ref.id,
        branch: ref.data.name,
        cwd: ref.data.cwd,
        at,
        x: working - SESSION_WIDTH / 2,
        y: at.y - CLI_STEP / 2,
        lead: RING_TRIM,
      });
    }
  }
}
