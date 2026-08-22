import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from "react";

/**
 * How far the pill is pulled for the first commit to come out of it, and how
 * little that is allowed to shrink to when there is not the room.
 *
 * Screen pixels rather than canvas ones: a pull is a movement of the hand, and
 * the same movement should ask for the same amount of history however far the
 * canvas happens to be zoomed out. What is drawn from it is in canvas pixels —
 * see the scale taken in `arm`.
 */
const PULL_STEP = 20;
const MIN_STEP = 6;

/** How long the press has to be held before it becomes a pull. */
const HOLD_MS = 300;

/**
 * How much history a pull the other way is never allowed to fold.
 *
 * The newest commit stays: it is what the branch heads stand on, and a band
 * folded down to nothing would have nothing left to unfold it by.
 */
const KEEP = 1;

/** What a hold fixes for the length of the pull it becomes. */
type Armed = {
  /** The pill's own width, which the pull is added to. */
  base: number;
  /** Screen pixels to the canvas pixel, so the pill keeps up with the hand. */
  scale: number;
  /** What was behind the fold when the hold fired. */
  hidden: number;
  /** And what was in front of it, which is what a pull the other way spends. */
  shown: number;
  /** What the first commit costs in pull, which the rest are counted from. */
  step: number;
};

/**
 * How much history a pull of this many steps asks for.
 *
 * The first step of the pull is worth one commit, the second two, the third
 * three: n steps bring back n(n+1)/2 of them. A history is hundreds of commits
 * deep and a hand's reach is not, so a straight commit per step either puts the
 * far end out of reach or makes the near end unpickable. This way the first few
 * still come out one at a time — which is what a pull is usually for — and the
 * far end is still a pull rather than a journey.
 */
function revealed(pulled: number, step: number): number {
  const steps = Math.max(0, pulled) / step;
  return Math.round((steps * steps + steps) / 2);
}

/** How many steps of pull `count` commits are worth: the sum above, undone. */
function stepsFor(count: number): number {
  return (Math.sqrt(1 + 8 * count) - 1) / 2;
}

/**
 * How far the pill can be pulled before it stops: the whole of what is folded.
 *
 * The pill is pulled towards the edge of the canvas and clipped by it, so the
 * room between the two is all the pull there is. Where a full-rate pull would
 * not fit in that room the step is shortened until it does, which is what keeps
 * the far end of a deep history reachable on a canvas whose left edge is close
 * behind the fold. Where there is room, the rate is the same everywhere.
 */
function stepIn(room: number, hidden: number): number {
  return Math.min(PULL_STEP, Math.max(MIN_STEP, room / stepsFor(hidden)));
}

/**
 * How much canvas there is between the pill and the edge it is pulled towards.
 *
 * The canvas clips what is drawn on it, so its edge is where the pull ends
 * whether or not the pointer carries on past it. Nothing to run into — the pill
 * outside a canvas, which is only the case under a test harness — is all the
 * room there is.
 */
function roomToEdge(element: Element, box: DOMRect): number {
  const canvas = element.closest(".react-flow")?.getBoundingClientRect();
  return canvas ? box.left - canvas.left : Number.POSITIVE_INFINITY;
}

/**
 * Where a pull has got to, for whatever is drawn behind the pill.
 *
 * The pull itself only ever writes the pill; this is how anything else keeps up
 * with it. Reported every frame the pill is redrawn and once more as `null`
 * when the press ends, so what is drawn from it never outlives the pull.
 */
export type Pull = {
  /**
   * How far the pill's far end — its left edge — stands from the centre of its
   * cell, in the layout's own pixels.
   *
   * Whatever is drawn behind the fold hangs off this rather than off the cell,
   * and so is never covered by the pill it is coming out of. A pull outwards
   * moves that edge and this grows with it; a pull the other way leaves it
   * where it is and takes the pill's other end instead.
   */
  far: number;
  /**
   * How much history the pull is asking for as it stands: out of the fold when
   * it is positive, back into it when it is negative.
   */
  reveal: number;
};

type Options = {
  /** How much history is behind the fold, which is what a pull draws on. */
  hidden: number;
  /** How much is in front of it, which is what a pull the other way draws on. */
  shown: number;
  /**
   * What the pull settled on: never none, never more than `hidden` out of the
   * fold, and never so far back into it that no history is left drawn.
   */
  onPull: (reveal: number) => void;
  /** What a press that was not held means, which is the whole of it. */
  onOpen: () => void;
  /** Where the pull has got to, each frame it is redrawn; `null` once it ends. */
  onPreview?: (pull: Pull | null) => void;
};

/**
 * Pulling the folded history open by hand.
 *
 * A press that is held turns the count into a handle: dragged out to the left
 * the pill stretches, and the number in it counts down to what would be left
 * folded away. Let go, and that is where the fold is put. It is the same fold
 * the marks on the lines make, asked for from the other end — those pick a
 * place in the history that is drawn, this one picks a depth in the history
 * that is not.
 *
 * It runs the other way as well. Pushed back in to the right the pill grows
 * over the history it is being closed onto and the count rises: the same handle
 * saying the same thing, with the fold deepening rather than opening. That
 * makes the bar the whole of the setting — how much history this repository is
 * showing, moved either way from wherever it stands — instead of a door that
 * only ever opens and a mark on some line to shut it again.
 *
 * Held rather than immediate because the press already means something: a click
 * brings the whole of the history back, and that is the right answer often
 * enough to keep. The hold is what separates asking for some of it from asking
 * for all of it, and a pull that comes back to where it started asks for
 * nothing — which is the way out of a hold that was not meant.
 *
 * Nothing on the canvas moves while the pull is going on. Every commit that
 * came back would rebuild its repository, repack the bands and walk every node
 * to a new place, and doing that on each frame of a drag would have the canvas
 * wandering about under the hand that is still choosing. So what the pull
 * writes is the pill's own width and the number in it, straight to the element
 * the way a drag writes anywhere else here: the choice is a number, the number
 * is what answers, and the graph answers once, at the end.
 */
export function useHistoryPull({ hidden, shown, onPull, onOpen, onPreview }: Options) {
  const pill = useRef<HTMLButtonElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  // Read through a ref rather than closed over: a pull outlives the render it
  // began in, and the graph is rebuilt underneath it whenever anything lands.
  const latest = useRef({ hidden, shown, onPull, onOpen, onPreview });
  latest.current = { hidden, shown, onPull, onOpen, onPreview };

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

    /**
     * How far the pill has been moved, and how much history that is worth.
     *
     * Signed: out to the left is history coming back, in to the right is
     * history being folded away. The rate and the sum behind it are the same
     * whichever way the hand goes — all that differs is what there is to run
     * out of, which is the fold at one end and the history drawn at the other.
     */
    const chosen = (fixed: Armed) => {
      const away = origin - at;
      if (away >= 0) {
        // Only as far as there is history to pull: past the end the pill stops
        // rather than stretching on saying the same number.
        const reach = stepsFor(fixed.hidden) * fixed.step;
        const drawn = Math.min(away, reach);
        return { drawn, reveal: Math.min(fixed.hidden, revealed(drawn, fixed.step)) };
      }

      const room = Math.max(0, fixed.shown - KEEP);
      const drawn = -Math.min(-away, stepsFor(room) * fixed.step);
      return { drawn, reveal: -Math.min(room, revealed(-drawn, fixed.step)) };
    };

    const draw = () => {
      if (!armed) return;
      const { drawn, reveal } = chosen(armed);
      const grown = drawn / armed.scale;
      // Out to the left with the hand, with the end the dashed line hangs off
      // staying where it is: the pill is the mouth of the fold, and the fold is
      // what is being pulled out of. Pushed the other way it is that far end
      // that stays and this one that moves, so the pill grows over the history
      // it is closing onto — which is the whole of what a close looks like.
      //
      // One expression for both because the sign says which: the width takes
      // the distance and the transform takes the direction. Half the growth is
      // given back to the transform because the pill is centred in its cell —
      // `.mark--centred` is what this is rewriting, so its own translate has to
      // be written again.
      element.style.width = `${armed.base + Math.abs(grown)}px`;
      element.style.transform = `translate(calc(-50% - ${grown / 2}px), -50%)`;
      // Which way it went, for the stylesheet: the count keeps to the end that
      // is moving, so that the number stays under the hand that is choosing it.
      element.classList.toggle("is-closing", grown < 0);
      // Counting down what would be left folded rather than up what is being
      // taken: the number in the pill means one thing whether it is being
      // pulled or sitting still, and nothing left folded is the whole history.
      if (count.current) count.current.textContent = String(armed.hidden - reveal);
      // The peek behind the pill is drawn from the same numbers, and drawn by
      // whoever asked for the pull: this hook owns the pill and nothing else.
      latest.current.onPreview?.({ far: armed.base / 2 + Math.max(0, grown), reveal });
    };

    const onFrame = () => {
      frame.current = 0;
      draw();
    };

    const arm = () => {
      hold.current = null;
      const base = element.offsetWidth;
      const box = element.getBoundingClientRect();
      // Taken once. History landing mid-pull must not move what is being
      // pointed at, and the graph is rebuilt for every commit that arrives.
      const { hidden, shown } = latest.current;
      armed = {
        base,
        // The pill is drawn inside the canvas's own transform, so a pixel of
        // hand is not a pixel of pill. Measured off the element itself rather
        // than read off the canvas: this is the scale that is actually on it.
        scale: base > 0 ? box.width / base : 1,
        hidden,
        shown,
        step: stepIn(roomToEdge(element, box), hidden),
      };
      element.classList.add("is-pulling");
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

      // Asked again at the point of release rather than taken from the last
      // frame drawn: the pull is what it was let go at, not where it had got to
      // when the screen last caught up.
      const { reveal } = chosen(armed);
      armed = null;
      // The pill goes back to what it was before the graph is told anything:
      // what was written on it was a proposal, and how much is folded away is
      // the graph's to say.
      element.classList.remove("is-pulling", "is-closing");
      element.style.width = "";
      element.style.transform = "";
      if (count.current) count.current.textContent = String(latest.current.hidden);
      latest.current.onPreview?.(null);
      // The release fires a click at the button as well, and that one means the
      // whole history. This press has already said how much of it it wanted.
      pulling.current = true;
      if (reveal !== 0) latest.current.onPull(reveal);
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

  // Handed over as one bundle so that the element the pull is written onto
  // cannot drift from the press that starts it.
  return { pill, count, onPointerDown, onClick };
}
