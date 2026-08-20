import { useEffect, useRef, useSyncExternalStore } from "react";

/** The smallest and largest a reading is still worth drawing at, in pixels. */
const SMALLEST = 8;
const LARGEST = 20;

/** What one press of the keys below comes to. */
const STEP = 1;

/** What the stylesheet draws a reading at, and what a bad stored size falls back to. */
const INITIAL = 11;

const KEY = "totex.reading.size";

function clamp(size: number): number {
  return Math.min(LARGEST, Math.max(SMALLEST, Math.round(size)));
}

function read(): number {
  try {
    const held = Number(localStorage.getItem(KEY));
    return held ? clamp(held) : INITIAL;
  } catch {
    return INITIAL;
  }
}

/**
 * How large every file card draws its reading.
 *
 * One size for all of them rather than one apiece: it is the reader's eyesight
 * being answered and not this file's, and a size that had to be set again for
 * every file opened would be set once and then endured. It outlives the window
 * for the same reason.
 *
 * Held here rather than in the node's data, as `graphMarks` is: React Flow
 * decides what to redraw by comparing that data, and a size that changes with a
 * keystroke would rebuild the graph's layout each time it did.
 */
let size = read();

const listeners = new Set<() => void>();

function subscribe(changed: () => void): () => void {
  listeners.add(changed);
  return () => {
    listeners.delete(changed);
  };
}

function snapshot(): number {
  return size;
}

/** Draw every reading this much larger, or smaller, as far as it will go. */
function resize(by: number) {
  const next = clamp(size + by);
  if (next === size) return;
  size = next;
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    // A window that cannot remember the size can still be read at it.
  }
  for (const changed of listeners) changed();
}

/** The size a card draws its reading at, redrawn when it changes. */
export function useReadingSize(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Which way a press wants the reading taken, and nothing for anything else.
 *
 * `+` is a shifted key on most layouts, its own key on the numeric pad, and the
 * same key says `=` unshifted — every window that resizes text takes all three
 * for the same thing, so this one does too. `-` is read the same way, except
 * for the shifted `_`: a terminal is what that press belongs to.
 */
function stepOf(event: KeyboardEvent): number {
  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") return STEP;
  if (event.key === "-" || event.code === "NumpadSubtract") return -STEP;
  return 0;
}

/**
 * Ctrl and a plus or a minus, while there is a file card on the canvas.
 *
 * Listened for on the window rather than on the card, because a card that is
 * only being read holds no focus to hang a handler off — its reading answers to
 * a click only where the file can be typed into. Every card is drawn at the one
 * size anyway, so which of them the press was meant for is not a question that
 * has to be answered.
 *
 * The press is taken whether or not there is a card to resize, and taken first,
 * because both of these belong to the webview until something says otherwise
 * and what it does with them is nothing this window offers. A plus is Ctrl and
 * a shifted semicolon on a Japanese keyboard, which is what WebKit opens its
 * symbol chooser on; a minus scales the whole window on Windows. Refusing the
 * default is what keeps the two presses to the reading and nothing else.
 */
export function useReadingKeys(open: boolean) {
  // Read by a listener that is registered once, so a card opening or closing
  // does not cost a pair of them.
  const wanted = useRef(open);
  wanted.current = open;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const by = stepOf(event);
      if (by === 0) return;
      event.preventDefault();
      if (wanted.current) resize(by);
    };

    // Captured on the way down: whatever is being typed into — a terminal, a
    // reading — sees the press only if this window has no use for it.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
