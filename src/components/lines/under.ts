/**
 * What the pointer is on, found by arithmetic rather than by asking the engine
 * to hit-test a thousand lines.
 */

import { useReactFlow, useStoreApi, type XYPosition } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import {
  type Band,
  COMMIT_STEP,
  type CommitFlowNode,
  DOT_SIZE,
  distanceTo,
  type FoldTarget,
  foldCell,
  STEP,
} from "../../lib/graph";
import { type CommitDot, commitAt } from "./bands";

/** How near the pointer has to come to a line, in screen pixels. */
const HOVER_SCREEN = 22;

/**
 * And the most that comes to on the canvas, so that a graph taken far out does
 * not make every line in a band answer at once.
 */
const HOVER_LIMIT = COMMIT_STEP.y * 0.6;

/** How near the pointer has to be to a dot to be on that commit. */
const DOT_REACH = 13;

/** The halo a live commit wears, which the offer stands inside the reach of. */
export const HALO_RADIUS = DOT_SIZE / 2 + 4;

/** How far above its dot the offer of a branch stands. */
export const BRANCH_LIFT = COMMIT_STEP.y / 2;

/** The disc it is drawn on, which is what there is to aim at. */
export const BRANCH_RADIUS = 9;

/** And how far from the dot that disc still answers. */
const BRANCH_REACH = 12;

/** What the pointer is on, which is the only thing these are ever drawn for. */
export type Under = {
  band: Band;
  fold: FoldTarget | null;
  dot: CommitDot | null;
  /** How near the pointer had to come, which the hit target is drawn at. */
  reach: number;
};

export function useUnder(
  bands: readonly Band[],
  standing: ReadonlyMap<string, XYPosition>,
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void,
): Under | null {
  const flow = useReactFlow();
  const store = useStoreApi();
  const [under, setUnder] = useState<Under | null>(null);
  // What is on screen now, so the listener can stay put across a rebuild.
  const showing = useRef(under);
  showing.current = under;
  const held = useRef(bands);
  held.current = bands;
  const placed = useRef(standing);
  placed.current = standing;
  const select = useRef(onCommit);
  select.current = onCommit;

  useEffect(() => {
    const host = store.getState().domNode;
    if (!host) return;

    const clear = () => {
      if (showing.current !== null) setUnder(null);
    };

    const find = (x: number, y: number): Under | null => {
      const at = flow.screenToFlowPosition({ x, y });
      const zoom = store.getState().transform[2];
      const reach = Math.min(HOVER_LIMIT, HOVER_SCREEN / zoom);

      for (const band of held.current) {
        const bandAt = placed.current.get(band.id) ?? band;
        const local = { x: at.x - bandAt.x, y: at.y - bandAt.y };
        // The band the cursor is actually in. Without this the cell worked out
        // against one band is looked up in another's index, and a repository
        // answers for a line that belongs to the one beside it. The margin is
        // what hangs off a band's own box: the offer of a branch, and the run
        // of sessions past the end of a row.
        if (
          local.x < -STEP.x ||
          local.y < -STEP.y ||
          local.x > band.width + STEP.x ||
          local.y > band.height + STEP.y
        ) {
          continue;
        }
        const cell = foldCell(local);

        const dot = band.lines.dots.get(cell);
        const dotAt = dot ? commitAt(dot, placed.current) : null;
        // The dot and the offer standing over it are one target. Aiming at the
        // offer means leaving the dot, and a commit that let go of the cursor
        // partway would take the offer away before it could be pressed.
        const onDot =
          dot &&
          dotAt &&
          (Math.hypot(dotAt.x - local.x, dotAt.y - local.y) <= DOT_REACH ||
            Math.hypot(dotAt.x - local.x, dotAt.y - BRANCH_LIFT - local.y) <= BRANCH_REACH);

        // Only the lines in the pointer's own cell are ever measured, which is
        // a handful of them however long the history is.
        let nearest: FoldTarget | null = null;
        let best = reach;
        for (const line of band.lines.folds.get(cell) ?? []) {
          const gap = distanceTo(line.run, local, best);
          if (gap <= best) {
            best = gap;
            nearest = line;
          }
        }

        if (!nearest && !onDot) continue;
        return { band, fold: nearest, dot: onDot ? dot : null, reach };
      }

      return null;
    };

    const move = (event: PointerEvent) => {
      // Mid-drag the canvas is moving under the cursor, and an offer that
      // appeared while it did would be an offer to fold whatever went past.
      if (event.buttons !== 0) {
        clear();
        return;
      }

      const next = find(event.clientX, event.clientY);
      if (next) {
        const now = showing.current;
        // The same answer as last time, which is what most moves of the mouse
        // come to: the cursor travels a long way inside one cell.
        if (now && now.band === next.band && now.fold === next.fold && now.dot === next.dot) return;
        setUnder(next);
        return;
      }

      clear();
    };

    /**
     * Commits no longer have DOM hit targets. Catch a press before React Flow
     * reads it as a pan, then turn a release on the same dot into the click the
     * old node supplied. A move remains neither a click nor a pan, just as a
     * press on the old `nopan` mark did.
     */
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".nopan")) return;
      const hit = find(event.clientX, event.clientY);
      if (!hit?.dot) return;

      event.preventDefault();
      event.stopPropagation();
      const dot = hit.dot;
      const origin = { x: event.clientX, y: event.clientY };
      let moved = false;

      const drag = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) > 4) moved = true;
      };
      const clean = () => {
        window.removeEventListener("pointermove", drag);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
      };
      const cancel = () => clean();
      const up = (ended: PointerEvent) => {
        if (ended.pointerId !== event.pointerId) return;
        clean();
        if (moved) return;
        const released = find(ended.clientX, ended.clientY);
        if (released?.dot !== dot) return;
        select.current(dot.node, { x: ended.clientX, y: ended.clientY });
      };

      window.addEventListener("pointermove", drag);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", cancel);
    };

    // The native click still follows the pointer pair even though its press was
    // stopped above. Keep React Flow's pane click from immediately clearing the
    // commit selection and closing the menu that release just opened — except
    // over the offer, which stands inside the commit's own reach and is the one
    // thing there that answers a click of its own.
    const click = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".nopan")) return;
      if (find(event.clientX, event.clientY)?.dot) event.stopPropagation();
    };

    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", clear);
    host.addEventListener("pointerdown", down, true);
    host.addEventListener("click", click, true);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", clear);
      host.removeEventListener("pointerdown", down, true);
      host.removeEventListener("click", click, true);
    };
  }, [flow, store]);

  return under;
}
