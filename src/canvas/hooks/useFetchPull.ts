import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from "react";

/**
 * How far the hand has to travel for the branch to be asked for.
 *
 * Screen pixels, like every other pull on this canvas: the gesture is a
 * movement of the hand, and the same movement should mean the same thing
 * however far the graph happens to be zoomed out.
 *
 * A threshold rather than a rate, because there is only one thing to ask for.
 * A history pull is graduated — every step of it is worth more commits — since
 * what it asks for is a depth; this asks a remote a question, and a question is
 * asked or it is not.
 */
const REACH = 44;

/**
 * Movement under this much is a press that wobbled, and the click still stands.
 *
 * The ring means something pressed as well as something pulled, so the two have
 * to be told apart by the hand rather than by which button was used.
 */
const SLOP = 6;

type Options = {
  /** The pull reached the far end and was let go there. */
  onFetch: () => void;
  /** What a press that never became a pull means, which is the whole of it. */
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  /** False where there is nothing to ask for, or nothing at rest to ask over. */
  live: boolean;
};

/**
 * Pulling the remote end of a branch out to ask the remote for the rest of it.
 *
 * The graph already has one pull: the fold at the old end of a history, drawn
 * open by hand to bring back commits this window is holding and not showing.
 * This is that gesture at the other end, and it means the next thing along —
 * what is out there has not been asked for yet, so pulling here goes and gets
 * it. The two read as one idea from opposite ends of the band: history comes
 * back on the left, and the remote comes down on the right.
 *
 * Nothing is drawn from React while the hand is moving. How far the pull has
 * got is written onto the handle as a custom property and the stylesheet draws
 * it, because a branch head that re-rendered on every frame of a drag would
 * take the whole band with it — see `useBranchDrag`, which writes its state
 * onto the canvas for the same reason.
 *
 * It runs outwards only. Inwards is where the history is, and a gesture that
 * meant one thing pulled left and another pulled right would be two gestures on
 * one mark; a pull that goes the wrong way simply never arrives.
 */
export function useFetchPull({ onFetch, onOpen, live }: Options) {
  const handle = useRef<HTMLButtonElement>(null);
  // Read through a ref rather than closed over: a pull outlives the render it
  // began in, and the head it started on is rebuilt whenever the graph moves.
  const latest = useRef({ onFetch, onOpen, live });
  latest.current = { onFetch, onOpen, live };

  const frame = useRef(0);
  /** Whether the click a release fires is the tail of a pull. */
  const pulling = useRef(false);

  // A frame owed when the head goes away has nothing left to draw on.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    // React Flow reads a press on the canvas as the start of a pan; this one is
    // the start of a press, and possibly of a pull.
    event.stopPropagation();
    if (event.button !== 0 || !latest.current.live) return;
    const element = handle.current;
    if (!element) return;
    // A click that never came leaves the flag set; the next press clears it.
    pulling.current = false;

    const origin = event.clientX;
    let at = origin;
    /** The last share drawn, so the same picture is never drawn twice. */
    let drawn = -1;

    /** How far along the pull is, as a share of what it takes. */
    const share = () => Math.min(1, Math.max(0, at - origin) / REACH);

    const draw = () => {
      frame.current = 0;
      const reached = share();
      if (reached === drawn) return;
      drawn = reached;
      element.style.setProperty("--reach", `${reached}`);
      element.classList.toggle("is-reached", reached === 1);
    };

    const move = (moved: globalThis.PointerEvent) => {
      at = moved.clientX;
      if (!pulling.current) {
        if (Math.abs(at - origin) < SLOP) return;
        pulling.current = true;
        element.classList.add("is-pulling");
      }
      // A frame already owed is the frame this move would have asked for;
      // `requestAnimationFrame` never hands out 0, so it stands for none.
      if (frame.current === 0) frame.current = requestAnimationFrame(draw);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      element.classList.remove("is-pulling", "is-reached");
      element.style.removeProperty("--reach");
      // Asked once more at the point of release rather than kept from the last
      // frame drawn: a pull is what it was let go at, not where it had got to
      // when the screen last caught up.
      if (pulling.current && share() === 1) latest.current.onFetch();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // The release fires a click at the button as well, and this press has
    // already said what it meant.
    if (pulling.current) {
      pulling.current = false;
      return;
    }
    latest.current.onOpen(event);
  }, []);

  // Handed over as one bundle so that the element the pull is drawn on cannot
  // drift from the press that starts it.
  return { handle, onPointerDown, onClick };
}
