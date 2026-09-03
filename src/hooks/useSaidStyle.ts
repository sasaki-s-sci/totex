/**
 * How the lines beside the terminals are set, written onto the canvas itself.
 *
 * Six of these marks may be on screen at once and every one of them is set the
 * same way, so the measures are put on the canvas and inherited rather than
 * handed to each mark: one place holds them, and a terminal appearing or going
 * away carries nothing about them.
 *
 * Written to the element rather than through a style prop, for the reason the
 * merge's own marks are: React only writes an attribute whose prop changed, and
 * the fitted half of this changes with every turn of the wheel. A prop would
 * mean the whole canvas rendering to move a number that only the stylesheet
 * reads — and `.graph` is an element other hooks already write to by hand, so a
 * style React owned would be a style it took back.
 */

import { type RefObject, useCallback, useEffect, useRef } from "react";

import { COMMIT_STEP } from "../lib/graph";
import { LINES, type Said, useSaid, WIDTH } from "../lib/said";

/**
 * How tall one line of the label is, as a share of its own size.
 *
 * The stylesheet's, kept here because the fitted line count is worked out from
 * it: how many lines fit in a row is how tall a row is over how tall a line is,
 * and asking the stylesheet at that moment would be a measurement taken per
 * frame of a number that never changes.
 */
const LINE = 1.35;

/**
 * What share of what is on screen a line may take when the canvas is deciding.
 *
 * A line stands beside a mark somewhere in the middle of the canvas, and where
 * that mark is is not something one place can know for all of them — so what is
 * measured is the room there is rather than the room this one has. Two fifths
 * leaves the graph itself the larger part of the view at every zoom, which is
 * what keeps this a label on the canvas rather than a column down the middle of
 * it.
 */
const SHARE = 0.4;

/** The measures as the stylesheet takes them. */
type Written = {
  size: string;
  lines: string;
  width: string;
};

function clamp(value: number, room: { least: number; most: number }): number {
  return Math.min(room.most, Math.max(room.least, Math.round(value)));
}

/**
 * The width and the line count the canvas would choose, out of the room it has.
 *
 * Two different rooms, because the two measures run out against different
 * things. A line's width is answerable to what is on screen — how much of the
 * canvas is in front of somebody is how much room there is to put a label in,
 * and it is measured on the canvas's own scale so that the answer is the same
 * label whatever the zoom. Its height is answerable to the grid: the graph puts
 * a row every half lane, and a label taller than that is one written across
 * whatever is standing underneath it.
 */
function fitted(across: number, size: number): { width: number; lines: number } {
  return {
    width: clamp(across * SHARE, WIDTH),
    lines: clamp(COMMIT_STEP.y / (size * LINE), LINES),
  };
}

function written(said: Said, across: number | null): Written {
  const fits = said.fitting && across !== null ? fitted(across, said.size) : null;
  return {
    size: `${said.size}px`,
    lines: String(fits ? fits.lines : said.lines),
    width: `${fits ? fits.width : said.width}px`,
  };
}

/**
 * Keeps the canvas saying how the lines are set, and hands back the one thing
 * that has to be told from outside: the zoom.
 *
 * The zoom is not held in state on purpose. It changes every frame of a pinch,
 * and what it is wanted for here is one number in a stylesheet — so it arrives
 * as a call from wherever the canvas is already answering the move, and what it
 * writes is written only where it came out different from last time.
 */
export function useSaidStyle(host: RefObject<HTMLDivElement | null>) {
  const said = useSaid();
  /** The last zoom heard about, so a resize can be answered without one. */
  const zoom = useRef(1);
  /** And the last thing written, so a frame that changes nothing writes nothing. */
  const standing = useRef<Written | null>(null);

  const apply = useCallback(
    (next: Said, at: number) => {
      const canvas = host.current;
      if (!canvas) return;
      // The pane's own width over the zoom: how much of the canvas is on
      // screen, said in the units the canvas is laid out in.
      const across = at > 0 ? canvas.clientWidth / at : null;
      // Which face is a name rather than a measure, so it is said as one: a
      // font stack handed through a custom property is a stack the fallback in
      // `var()` is fighting with, and `inherit` is not a value that survives
      // being substituted into one.
      canvas.dataset.saidFace = next.face;

      const write = written(next, across);
      const before = standing.current;
      if (
        before &&
        before.size === write.size &&
        before.lines === write.lines &&
        before.width === write.width
      ) {
        return;
      }
      standing.current = write;
      canvas.style.setProperty("--said-size", write.size);
      canvas.style.setProperty("--said-lines", write.lines);
      canvas.style.setProperty("--said-width", write.width);
    },
    [host],
  );

  /** What the canvas calls as it moves, which is the only way the zoom arrives. */
  const fit = useCallback(
    (at: number) => {
      zoom.current = at;
      apply(said, at);
    },
    [apply, said],
  );

  useEffect(() => {
    apply(said, zoom.current);
  }, [apply, said]);

  // The other half of the room: the window being resized changes how much of
  // the canvas is on screen without the zoom moving at all.
  useEffect(() => {
    const canvas = host.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const watching = new ResizeObserver(() => apply(said, zoom.current));
    watching.observe(canvas);
    return () => watching.disconnect();
  }, [apply, host, said]);

  return fit;
}
