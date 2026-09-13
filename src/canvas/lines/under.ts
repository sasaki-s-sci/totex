// Hit-testing by arithmetic rather than asking the engine to test a thousand lines.

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
  type Hold,
  midpointOf,
  type Point,
  STEP,
  samplesOf,
} from "../../lib/graph";
import { type CommitDot, commitAt } from "./bands";
import { endsOf } from "./path";

const HOVER_SCREEN = 22;

const HOVER_LIMIT = COMMIT_STEP.y * 0.6;

const DOT_REACH = 13;

export const HALO_RADIUS = DOT_SIZE / 2 + 4;

export const BRANCH_LIFT = COMMIT_STEP.y / 2;

export const BRANCH_RADIUS = 9;

const BRANCH_REACH = 12;

export type Under =
  | {
      kind: "band";
      band: Band;
      fold: FoldTarget | null;
      dot: CommitDot | null;

      reach: number;
    }
  | {
      kind: "hold";
      hold: Hold;
      reach: number;
    };

export function holdRun(
  hold: Hold,
  standing: ReadonlyMap<string, XYPosition>,
): { run: number[]; at: Point } | null {
  const ends = endsOf(hold.line, standing);
  if (!ends) return null;
  if (hold.line.shape !== "elbow") {
    return {
      run: samplesOf(ends.start, ends.end, hold.line.shape),
      at: midpointOf(ends.start, ends.end, hold.line.shape),
    };
  }
  const corner = { x: ends.start.x, y: ends.end.y };
  return {
    run: [corner.x, corner.y, ends.end.x, ends.end.y],
    at: midpointOf(corner, ends.end, "straight"),
  };
}

export function useUnder(
  bands: readonly Band[],
  holds: readonly Hold[],
  standing: ReadonlyMap<string, XYPosition>,
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void,
): Under | null {
  const flow = useReactFlow();
  const store = useStoreApi();
  const [under, setUnder] = useState<Under | null>(null);

  const showing = useRef(under);
  showing.current = under;
  const held = useRef(bands);
  held.current = bands;
  const holding = useRef(holds);
  holding.current = holds;
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
        // The band as it stands now, so a cell is not looked up in a neighbouring band's index.
        const bandAt = placed.current.get(band.id) ?? band;
        const local = { x: at.x - bandAt.x, y: at.y - bandAt.y };

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

        const onDot =
          dot &&
          dotAt &&
          (Math.hypot(dotAt.x - local.x, dotAt.y - local.y) <= DOT_REACH ||
            Math.hypot(dotAt.x - local.x, dotAt.y - BRANCH_LIFT - local.y) <= BRANCH_REACH);

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
        return { kind: "band", band, fold: nearest, dot: onDot ? dot : null, reach };
      }

      let nearest: Hold | null = null;
      let best = reach;
      for (const hold of holding.current) {
        const drawn = holdRun(hold, placed.current);
        if (!drawn) continue;
        const gap = distanceTo(drawn.run, at, best);
        if (gap <= best) {
          best = gap;
          nearest = hold;
        }
      }
      if (nearest) return { kind: "hold", hold: nearest, reach };

      return null;
    };

    const move = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        clear();
        return;
      }

      const next = find(event.clientX, event.clientY);
      if (next) {
        const now = showing.current;

        if (now && same(now, next)) return;
        setUnder(next);
        return;
      }

      clear();
    };

    // Commits have no DOM hit targets: take the press before React Flow reads it as a pan, and turn a release on the same dot into the click.
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".nopan")) return;
      const hit = find(event.clientX, event.clientY);
      if (hit?.kind !== "band" || !hit.dot) return;

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
        if (released?.kind !== "band" || released.dot !== dot) return;
        select.current(dot.node, { x: ended.clientX, y: ended.clientY });
      };

      window.addEventListener("pointermove", drag);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", cancel);
    };

    // The native click still fires after the stopped press; keep React Flow's pane click from clearing the selection the release just made.
    const click = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".nopan")) return;
      const hit = find(event.clientX, event.clientY);
      if (hit?.kind === "band" && hit.dot) event.stopPropagation();
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

function same(now: Under, next: Under): boolean {
  if (now.kind === "band" && next.kind === "band") {
    return now.band === next.band && now.fold === next.fold && now.dot === next.dot;
  }
  return now.kind === "hold" && next.kind === "hold" && now.hold === next.hold;
}
