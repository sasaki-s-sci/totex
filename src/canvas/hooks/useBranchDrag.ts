import { type RefObject, useCallback, useEffect, useRef } from "react";

import type { Repository } from "../../types/git";

export type Drag = {
  repository: Repository;
  branch: string;

  origin: string | null;
  over: string | null;
};

// Drag state is written to the DOM, not React state: a render per pointer move is most of a frame on a big workspace. Hit tests use graph geometry; elementFromPoint or getBoundingClientRect forces a full SVG layout on the first drag frame.
export function useBranchDrag(
  host: RefObject<HTMLDivElement | null>,
  onDrop: (repository: Repository, source: string, target: string) => void,
  headUnder: (repository: Repository, source: string, x: number, y: number) => string | null,
  originUnder: (repository: Repository, branch: string) => string | null,
) {
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const show = useCallback(
    (drag: Drag | null) => {
      const canvas = host.current;
      if (!canvas) return;
      canvas.classList.toggle("is-merging", drag !== null);
      for (const marked of canvas.querySelectorAll(
        ".is-merge-source, .is-merge-target, .is-merge-origin",
      )) {
        marked.classList.remove("is-merge-source", "is-merge-target", "is-merge-origin");
      }

      if (drag) {
        canvas.dataset.mergeRepository = drag.repository.id;
        canvas.dataset.mergeSource = drag.branch;
        for (const head of canvas.querySelectorAll<HTMLElement>(".head[data-branch]")) {
          if (head.dataset.repository !== drag.repository.id) continue;
          if (head.dataset.branch === drag.branch) head.classList.add("is-merge-source");
          if (drag.origin && head.dataset.branch === drag.origin) {
            head.classList.add("is-merge-origin");
          }
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

      const origin = originUnder(repository, branch);
      show({ repository, branch, origin, over: null });

      let at = { x: event.clientX, y: event.clientY };
      let over: string | null = null;

      // No pointer capture: it throws for pointers the browser does not consider active.
      const look = () => {
        frame.current = 0;
        const under = headUnder(repository, branch, at.x, at.y);

        if (under === over) return;
        over = under;
        show({ repository, branch, origin, over });
      };

      const move = (moved: PointerEvent) => {
        at = { x: moved.clientX, y: moved.clientY };

        // requestAnimationFrame never returns 0, so 0 means no frame owed.
        if (frame.current === 0) frame.current = requestAnimationFrame(look);
      };

      const up = (ended: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        show(null);

        const target = headUnder(repository, branch, ended.clientX, ended.clientY);
        if (target) onDrop(repository, branch, target);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [headUnder, onDrop, originUnder, show],
  );

  return start;
}
