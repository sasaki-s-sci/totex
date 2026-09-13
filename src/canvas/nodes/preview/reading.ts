import { useCallback, useEffect, useRef, useState } from "react";
import { rail } from "./measure";

/** What one line of a wheel comes to, for the mice that count in lines. */
const LINE = 16;

/** How much of the box is kept past the caret when it is brought back in. */
const CARET_ROOM = 16;

/**
 * Moving the reading inside its card, rather than scrolling it.
 *
 * A box with more in it than fits, that can be scrolled to reach the rest, is a
 * scroller — and a scroller on the canvas is a compositing layer of its own,
 * which is enough to have the whole graph drawn once at one scale and stretched
 * to whatever it is zoomed to. `canvas/index.css` states the rule at its head. So the
 * body is clipped, the reading is moved by a transform, and how far it has been
 * moved is drawn as a pair of rails.
 *
 * Written to the elements rather than held as state: a wheel arrives many times
 * a second, a keystroke nearly as often, and none of it is anything the graph
 * has to be laid out again for.
 */
export function useReading() {
  // The two elements that anything here has to be told about are held as state
  // rather than as refs: a card put away and taken back out draws a new box and
  // a new reading, and an effect that watches a ref is never told. What was
  // watched then was an element that is no longer in the window.
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [paper, setPaper] = useState<HTMLPreElement | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const across = useRef<HTMLElement>(null);
  const down = useRef<HTMLElement>(null);
  const at = useRef({ x: 0, y: 0 });
  const wheel = useRef({ x: 0, y: 0 });
  const wheelFrame = useRef<number | null>(null);
  const caretFrame = useRef<number | null>(null);

  /** Move by this much, and redraw where that leaves everything. */
  const move = useCallback(
    (dx: number, dy: number) => {
      const box = body;
      const reading = sheet.current;
      if (!box || !reading) return;
      const room = {
        x: Math.max(0, reading.offsetWidth - box.clientWidth),
        y: Math.max(0, reading.offsetHeight - box.clientHeight),
      };
      const now = {
        x: Math.min(room.x, Math.max(0, at.current.x + dx)),
        y: Math.min(room.y, Math.max(0, at.current.y + dy)),
      };
      at.current = now;
      reading.style.transform = `translate(${-now.x}px, ${-now.y}px)`;
      if (gutter.current) gutter.current.style.transform = `translateX(${now.x}px)`;
      rail(across.current, "width", "left", box.clientWidth, reading.offsetWidth, now.x, room.x);
      rail(down.current, "height", "top", box.clientHeight, reading.offsetHeight, now.y, room.y);
    },
    [body],
  );

  /** Back to the top of a reading that has just been opened. */
  const home = useCallback(() => {
    wheel.current = { x: 0, y: 0 };
    at.current = { x: 0, y: 0 };
    move(0, 0);
  }, [move]);

  // A trackpad can send several wheel events inside one display frame. Their
  // distance is additive, but measuring and writing the reading for each event
  // only forces the same layout several times before any of it can be painted.
  // Keep all of the distance and apply it once at the next frame boundary.
  const queueMove = useCallback(
    (dx: number, dy: number) => {
      wheel.current.x += dx;
      wheel.current.y += dy;
      if (wheelFrame.current !== null) return;
      wheelFrame.current = requestAnimationFrame(() => {
        wheelFrame.current = null;
        const next = wheel.current;
        wheel.current = { x: 0, y: 0 };
        move(next.x, next.y);
      });
    },
    [move],
  );

  // The box changes size when the card is dragged by an edge or put away, and
  // the reading changes when the file is read or typed into: either can leave
  // it standing past its own end, so both settle it back with a move of
  // nothing.
  useEffect(() => {
    if (!body) return;
    const watch = new ResizeObserver(() => move(0, 0));
    watch.observe(body);
    return () => watch.disconnect();
  }, [body, move]);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      // Most wheels count in pixels; some count in lines, and a page is the box.
      const step =
        event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? (body?.clientHeight ?? 0) : 1;
      queueMove(event.deltaX * step, event.deltaY * step);
    },
    [body, queueMove],
  );

  /**
   * Brings the caret back into the box when typing has taken it outside.
   *
   * Nothing else would: the box is clipped rather than scrolled, so there is no
   * scroller for the engine to bring the caret into view in, and the line being
   * typed would simply carry on past the edge. The caret is measured on screen,
   * where the canvas's zoom is already in it, so the move is taken back through
   * the scale the box is drawn at.
   */
  const showCaretNow = useCallback(() => {
    const box = body;
    const selection = document.getSelection();
    if (!box || !selection || selection.rangeCount === 0) return;
    const caret = selection.getRangeAt(0).getBoundingClientRect();
    if (caret.height === 0 && caret.width === 0) return;
    const frame = box.getBoundingClientRect();
    const scale = box.clientWidth > 0 ? frame.width / box.clientWidth : 1;
    const room = CARET_ROOM * scale;
    const dx =
      caret.left < frame.left + room
        ? caret.left - frame.left - room
        : caret.right > frame.right - room
          ? caret.right - frame.right + room
          : 0;
    const dy =
      caret.top < frame.top
        ? caret.top - frame.top
        : caret.bottom > frame.bottom
          ? caret.bottom - frame.bottom
          : 0;
    if (dx === 0 && dy === 0) return;
    move(dx / scale, dy / scale);
  }, [body, move]);

  // Selection geometry is only settled after the edit event. Waiting for the
  // next frame both gives the browser that chance and coalesces input and keyup
  // into one measurement.
  const showCaret = useCallback(() => {
    if (caretFrame.current !== null) return;
    caretFrame.current = requestAnimationFrame(() => {
      caretFrame.current = null;
      showCaretNow();
    });
  }, [showCaretNow]);

  useEffect(
    () => () => {
      if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
      if (caretFrame.current !== null) cancelAnimationFrame(caretFrame.current);
    },
    [],
  );

  return { setBody, sheet, gutter, paper, setPaper, across, down, move, home, onWheel, showCaret };
}
