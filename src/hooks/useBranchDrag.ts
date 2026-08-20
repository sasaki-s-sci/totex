import { type RefObject, useCallback, useEffect, useRef } from "react";

import type { Repository } from "../types/git";

/** A branch being dragged, and the head it is currently over. */
export type Drag = { repository: Repository; branch: string; over: string | null };

/**
 * Dragging one branch head onto another, which is how a merge is asked for.
 *
 * Written onto the canvas rather than kept in state: what a drag has to say is
 * which branch is in hand and which one it is over, and the stylesheet is the
 * only thing that reads any of it. The two head elements are marked directly;
 * the same values are published on the canvas so the state remains inspectable.
 * A few classes and three attributes are what saying it costs — against a
 * render of the whole graph, which on a workspace's worth of repositories is
 * most of a frame for a fact that changes nothing React draws.
 *
 * A pointer move is not news either. The aim is worked out on the frames the
 * pointer moved in and not on every report of it: a pointer reports faster than
 * the screen redraws — 120Hz and better on the machines this runs on — and
 * every report past the first in a frame is an answer thrown away before
 * anything is drawn from it.
 *
 * What is under the pointer is worked out from the graph's own coordinates,
 * never by asking the document. `elementFromPoint` walks the whole canvas and
 * even one `getBoundingClientRect` can force the WebView to lay out its full
 * SVG before the first drag frame. The graph already knows every head's centre
 * and React Flow already knows the viewport transform, so the same circle test
 * is arithmetic from start to finish.
 *
 * It differs from the document's own answer in one way: a head that something
 * is drawn over — the window's drag band along the top, the zoom controls in
 * the corner — still counts as being under the pointer. The ring shows through
 * both of them, so that is the answer the eye would give.
 *
 * @param host The canvas the drag is happening on, which is what it is written
 *   onto: `is-merging` while one is in hand, their repository, and the two ends
 *   by name.
 */
export function useBranchDrag(
  host: RefObject<HTMLDivElement | null>,
  onDrop: (repository: Repository, source: string, target: string) => void,
  headUnder: (repository: Repository, source: string, x: number, y: number) => string | null,
) {
  const frame = useRef(0);

  // A look owed when the canvas goes away has nothing left to look at.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Puts the drag on the canvas, or takes it off again. */
  const show = useCallback(
    (drag: Drag | null) => {
      const canvas = host.current;
      if (!canvas) return;
      canvas.classList.toggle("is-merging", drag !== null);
      for (const marked of canvas.querySelectorAll(".is-merge-source, .is-merge-target")) {
        marked.classList.remove("is-merge-source", "is-merge-target");
      }
      // There is no value an attribute can hold that means it is not there, so
      // the end of a drag takes them off rather than blanking them.
      if (drag) {
        canvas.dataset.mergeRepository = drag.repository.id;
        canvas.dataset.mergeSource = drag.branch;
        for (const head of canvas.querySelectorAll<HTMLElement>(".head[data-branch]")) {
          if (head.dataset.repository !== drag.repository.id) continue;
          if (head.dataset.branch === drag.branch) head.classList.add("is-merge-source");
          if (drag.over && head.dataset.branch === drag.over) head.classList.add("is-merge-target");
        }
      } else {
        delete canvas.dataset.mergeRepository;
        delete canvas.dataset.mergeSource;
      }
      if (drag?.over) canvas.dataset.mergeTarget = drag.over;
      else delete canvas.dataset.mergeTarget;
    },
    [host],
  );

  const start = useCallback(
    (repository: Repository, branch: string, event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const canvas = event.currentTarget.closest<HTMLDivElement>(".graph");
      if (!canvas) return;
      // No pointer capture: the move and release are tracked on the window, so
      // capture buys nothing — and it throws outright for any pointer the
      // browser does not consider active, which would leave the drag unarmed.
      show({ repository, branch, over: null });

      // Where the pointer got to, and what it was last over. Both are held here
      // rather than in state: they are read again on the next frame, not drawn.
      let at = { x: event.clientX, y: event.clientY };
      let over: string | null = null;

      const look = () => {
        frame.current = 0;
        const under = headUnder(repository, branch, at.x, at.y);
        // The same answer is not news, and the canvas is styled from this.
        if (under === over) return;
        over = under;
        show({ repository, branch, over });
      };

      const move = (moved: PointerEvent) => {
        at = { x: moved.clientX, y: moved.clientY };
        // A frame already owed is the same frame this move would have asked
        // for; `requestAnimationFrame` never hands out 0, so it stands for none.
        if (frame.current === 0) frame.current = requestAnimationFrame(look);
      };

      const up = (ended: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        show(null);
        // Asked again at the point of release rather than taken from the last
        // frame: the merge is what the drag was for, and it goes where the
        // pointer actually let go, not where it was when the screen last drew.
        const target = headUnder(repository, branch, ended.clientX, ended.clientY);
        if (target) onDrop(repository, branch, target);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [headUnder, onDrop, show],
  );

  return start;
}
