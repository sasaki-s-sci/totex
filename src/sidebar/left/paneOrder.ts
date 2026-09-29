import type { DragEventHandler } from "react";

/** What a pane spreads on the part of it that is picked up: its header, or its one row. */
export type PaneGrip = {
  draggable: true;
  onDragStart: DragEventHandler<HTMLElement>;
  onDragEnd: DragEventHandler<HTMLElement>;
};

/** Carried by a pane's header while it is dragged to another place in the column. */
export const PANE_DRAG_TYPE = "application/x-totex-pane";

/**
 * The panes with `id` taken out and put back before the one at `slot`, a slot counted in the list
 * as it stands; `slot` past the last puts it at the end. The same list when that is where it is.
 */
export function movePane<T extends { id: number }>(panes: T[], id: number, slot: number): T[] {
  const from = panes.findIndex((pane) => pane.id === id);
  if (from < 0) return panes;
  const to = Math.max(0, Math.min(slot, panes.length));
  // Before itself or before the one after it: nothing moves.
  if (to === from || to === from + 1) return panes;
  const rest = panes.filter((pane) => pane.id !== id);
  const at = to > from ? to - 1 : to;
  return [...rest.slice(0, at), panes[from], ...rest.slice(at)];
}

/** The slot a pointer at `y` stands over: before the first pane whose middle is below it. */
export function slotAt(boxes: readonly { top: number; bottom: number }[], y: number): number {
  const below = boxes.findIndex((box) => y < (box.top + box.bottom) / 2);
  return below < 0 ? boxes.length : below;
}
