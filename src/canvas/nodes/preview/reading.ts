import { useCallback, useEffect, useRef, useState } from "react";
import { rail } from "./measure";

const LINE = 16;

const CARET_ROOM = 16;

// Moved by a transform, never scrolled: a scroller on the canvas is its own compositing layer,
// and the whole graph then rasterises at one scale (see styles/index.css).
export function useReading() {
  // State, not refs: a card put away and back draws new elements, and an effect watching a ref is never told.
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

  const home = useCallback(() => {
    wheel.current = { x: 0, y: 0 };
    at.current = { x: 0, y: 0 };
    move(0, 0);
  }, [move]);

  // Several wheel events per frame are summed and applied once.
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

  useEffect(() => {
    if (!body) return;
    const watch = new ResizeObserver(() => move(0, 0));
    watch.observe(body);
    return () => watch.disconnect();
  }, [body, move]);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      const step =
        event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? (body?.clientHeight ?? 0) : 1;
      queueMove(event.deltaX * step, event.deltaY * step);
    },
    [body, queueMove],
  );

  // The box is clipped, so nothing brings the caret into view; measured on screen, so divided by the zoom.
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

  // Selection geometry settles only after the edit event.
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
