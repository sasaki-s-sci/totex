import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from "react";

/** How far the pill is pulled for the first commit to come out, and the least
 *  that may shrink to. Screen pixels rather than canvas ones: the same movement
 *  should ask for the same history however far the canvas is zoomed out. */
const PULL_STEP = 20;
const MIN_STEP = 6;

/** How long the press has to be held before it becomes a pull. */
const HOLD_MS = 300;

/** What a pull the other way may never fold: the newest commit stays, because
 *  it is what the branch heads stand on. */
const KEEP = 1;

/** What a hold fixes for the length of the pull it becomes. */
type Armed = {
  /** What was behind the fold when the hold fired. */
  hidden: number;
  /** What was in front of the fold when the pull began, counted once: the
   *  repository is laid out afresh each frame, so counting from what it shows
   *  part-way through would add every move of the hand to itself. */
  shown: number;
  /** What the first commit costs in pull, which the rest are counted from. */
  step: number;
};

/** How much history a pull of this many steps asks for: n steps bring back
 *  n(n+1)/2 commits, so the first few come out one at a time and the far end of
 *  a deep history is still a pull rather than a journey. */
function revealed(pulled: number, step: number): number {
  const steps = Math.max(0, pulled) / step;
  return Math.round((steps * steps + steps) / 2);
}

/** How many steps of pull `count` commits are worth: the sum above, undone. */
function stepsFor(count: number): number {
  return (Math.sqrt(1 + 8 * count) - 1) / 2;
}

/** How far the hand has to travel for the whole fold to come out. The room
 *  between the pill and the window's edge is all the pull there is, so a
 *  full-rate step is shortened until it fits. */
function stepIn(room: number, hidden: number): number {
  return Math.min(PULL_STEP, Math.max(MIN_STEP, room / stepsFor(hidden)));
}

/** How much canvas there is between the pill and the edge, measured once as the
 *  hold fires: the canvas stands back while the pull goes on, and a rate that
 *  chased that would run away from the hand setting it. */
function roomToEdge(element: Element, box: DOMRect): number {
  const canvas = element.closest(".react-flow")?.getBoundingClientRect();
  return canvas ? box.left - canvas.left : Number.POSITIVE_INFINITY;
}

type Options = {
  /** How much history is behind the fold, which is what a pull draws on. */
  hidden: number;
  /** How much is in front of it, which is what a pull the other way draws on. */
  shown: number;
  /** What a press that was not held means, which is the whole of it. */
  onOpen: () => void;
  /** How deep a history the pull is asking for, on every frame it moves.
   *  `null` says it is over and asked for nothing; a pull that ended anywhere
   *  else says so through `onKeep`, and exactly one of the two is called. */
  onReach: (shown: number | null) => void;
  /** The pull ended somewhere else: the depth it last reached is the answer. */
  onKeep: () => void;
};

/**
 * Pulling the folded history open by hand.
 *
 * A press that is held turns the count into a handle: moved left, history comes
 * back; moved right, the fold deepens. The repository is laid out again at the
 * depth the hand has reached on every frame and drawn as a proposal — dashed
 * throughout — and letting go is what settles it.
 *
 * Held rather than immediate because a plain click already means something: it
 * brings the whole history back. A pull that comes back to where it started
 * asks for nothing, which is the way out of a hold that was not meant. The pill
 * itself never moves: it is the point everything else grows away from.
 */
export function useHistoryPull({ hidden, shown, onOpen, onReach, onKeep }: Options) {
  const pill = useRef<HTMLButtonElement>(null);
  // Read through a ref rather than closed over: a pull outlives the render it
  // began in, and every frame of it builds the node it started on again.
  const latest = useRef({ hidden, shown, onOpen, onReach, onKeep });
  latest.current = { hidden, shown, onOpen, onReach, onKeep };

  const frame = useRef(0);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the click a release fires is the tail of a pull. */
  const pulling = useRef(false);

  // A frame or a hold owed when the node goes away has nothing left to answer.
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    // React Flow reads a press on the canvas as the start of a pan; this one is
    // the start of a press, and possibly of a pull.
    event.stopPropagation();
    if (event.button !== 0) return;
    const element = pill.current;
    if (!element) return;
    // A click that never came leaves the flag set; the next press clears it.
    pulling.current = false;

    const origin = event.clientX;
    let at = origin;
    /** What the hold settled on, and null until it has fired. */
    let armed: Armed | null = null;
    /** The last depth asked for, so the same one is never asked for twice. */
    let asked = -1;

    /** How much history the pull is worth where the hand has got to. Signed:
     *  left is history coming back, right is history being folded away. */
    const chosen = (fixed: Armed) => {
      const away = origin - at;
      if (away >= 0) {
        // Only as far as there is history to pull: past the end the hand goes
        // on moving and the answer stops changing.
        const reach = stepsFor(fixed.hidden) * fixed.step;
        return Math.min(fixed.hidden, revealed(Math.min(away, reach), fixed.step));
      }

      const room = Math.max(0, fixed.shown - KEEP);
      return -Math.min(room, revealed(Math.min(-away, stepsFor(room) * fixed.step), fixed.step));
    };

    const draw = () => {
      if (!armed) return;
      const depth = armed.shown + chosen(armed);
      // A whole repository is what a depth costs, and a frame the hand spent
      // inside one commit's worth of travel would buy the same picture twice.
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
      // Taken once. History landing mid-pull must not move what is being
      // pointed at, and the graph is rebuilt for every commit that arrives.
      const { hidden, shown } = latest.current;
      const room = roomToEdge(element, element.getBoundingClientRect());
      armed = { hidden, shown, step: stepIn(room, hidden) };
      element.classList.add("is-pulling");
      // What the hold itself is worth: the band goes over to dashes at the
      // depth it is already showing, which is how the press says it has taken.
      draw();
    };

    const move = (moved: globalThis.PointerEvent) => {
      at = moved.clientX;
      // A frame already owed is the frame this move would have asked for;
      // `requestAnimationFrame` never hands out 0, so it stands for none. A
      // pointer reports faster than the screen redraws, and every report past
      // the first in a frame is an answer thrown away before it is seen.
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
      // Too short to be a hold, so it was a click, and the click still means
      // what it always did.
      if (!armed) return;

      const fixed = armed;
      armed = null;
      element.classList.remove("is-pulling");
      // The release fires a click at the button as well, and that one means the
      // whole history. This press has already said how much of it it wanted.
      pulling.current = true;

      // Asked once more at the point of release rather than kept from the last
      // frame drawn: the pull is what it was let go at, not where it had got to
      // when the screen last caught up.
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

  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (pulling.current) {
      pulling.current = false;
      return;
    }
    latest.current.onOpen();
  }, []);

  // Handed over as one bundle so that the element the pull is measured from
  // cannot drift from the press that starts it.
  return { pill, onPointerDown, onClick };
}
