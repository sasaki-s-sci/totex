import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from "react";

// Screen pixels, so the gesture means the same at any zoom.
const PULL_STEP = 20;
const MIN_STEP = 6;

const HOLD_MS = 300;

const KEEP = 1;

type Armed = {
  hidden: number;

  shown: number;

  step: number;
};

function revealed(pulled: number, step: number): number {
  const steps = Math.max(0, pulled) / step;
  return Math.round((steps * steps + steps) / 2);
}

// n steps bring back n(n+1)/2 commits: one at a time near the fold, fast at depth.
function stepsFor(count: number): number {
  return (Math.sqrt(1 + 8 * count) - 1) / 2;
}

function stepIn(room: number, hidden: number): number {
  return Math.min(PULL_STEP, Math.max(MIN_STEP, room / stepsFor(hidden)));
}

// Measured once at the hold: the canvas stands back during the pull, and a rate that chased it would run away.
function roomToEdge(element: Element, box: DOMRect): number {
  const canvas = element.closest(".react-flow")?.getBoundingClientRect();
  return canvas ? box.left - canvas.left : Number.POSITIVE_INFINITY;
}

type Options = {
  hidden: number;

  shown: number;

  onOpen: () => void;

  onReach: (shown: number | null) => void;

  onKeep: () => void;
};

export function useHistoryPull({ hidden, shown, onOpen, onReach, onKeep }: Options) {
  const pill = useRef<HTMLButtonElement>(null);

  // Ref, not closure: a pull outlives the render it began in.
  const latest = useRef({ hidden, shown, onOpen, onReach, onKeep });
  latest.current = { hidden, shown, onOpen, onReach, onKeep };

  const frame = useRef(0);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pulling = useRef(false);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const element = pill.current;
    if (!element) return;

    pulling.current = false;

    const origin = event.clientX;
    let at = origin;

    let armed: Armed | null = null;

    let asked = -1;

    const chosen = (fixed: Armed) => {
      const away = origin - at;
      if (away >= 0) {
        const reach = stepsFor(fixed.hidden) * fixed.step;
        return Math.min(fixed.hidden, revealed(Math.min(away, reach), fixed.step));
      }

      const room = Math.max(0, fixed.shown - KEEP);
      return -Math.min(room, revealed(Math.min(-away, stepsFor(room) * fixed.step), fixed.step));
    };

    const draw = () => {
      if (!armed) return;
      const depth = armed.shown + chosen(armed);

      if (depth === asked) return;
      asked = depth;
      latest.current.onReach(depth);
    };

    const onFrame = () => {
      frame.current = 0;
      draw();
    };

    const arm = () => {
      hold.current = null;

      const { hidden, shown } = latest.current;
      const room = roomToEdge(element, element.getBoundingClientRect());
      armed = { hidden, shown, step: stepIn(room, hidden) };
      element.classList.add("is-pulling");

      draw();
    };

    const move = (moved: globalThis.PointerEvent) => {
      at = moved.clientX;

      // requestAnimationFrame never returns 0, so 0 means no frame owed.
      if (armed && frame.current === 0) frame.current = requestAnimationFrame(onFrame);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (hold.current) {
        clearTimeout(hold.current);
        hold.current = null;
      }

      if (!armed) return;

      const fixed = armed;
      armed = null;
      element.classList.remove("is-pulling");

      pulling.current = true;

      const reveal = chosen(fixed);
      if (reveal === 0) {
        latest.current.onReach(null);
        return;
      }
      latest.current.onReach(fixed.shown + reveal);
      latest.current.onKeep();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    hold.current = setTimeout(arm, HOLD_MS);
  }, []);

  // The release also fires a click, which would mean the whole history.
  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (pulling.current) {
      pulling.current = false;
      return;
    }
    latest.current.onOpen();
  }, []);

  return { pill, onPointerDown, onClick };
}
