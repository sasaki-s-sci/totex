import { useEffect, useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "../lib/appSettings";
import { reading } from "../lib/keys";

/** The smallest and largest a reading is still worth drawing at, in pixels. */
const SMALLEST = 8;
const LARGEST = 20;

/** What one press of the keys below comes to. */
const STEP = 1;

function clamp(size: number): number {
  return Math.min(LARGEST, Math.max(SMALLEST, Math.round(size)));
}
function snapshot(): number {
  return settingsNow().readingSize;
}
function resize(by: number) {
  updateSettings({ readingSize: clamp(snapshot() + by) });
}
export function useReadingSize(): number {
  return useSyncExternalStore(subscribeSettings, snapshot, snapshot);
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
 * Ctrl and a plus or a minus, while a file card has the focus.
 *
 * The press is for the card, so the card is what has to be holding the focus:
 * a window with a file open somewhere on the canvas is not a window that is
 * reading it, and a terminal being typed into is not resized by this. What
 * counts as the card having the focus is `reading` in `lib/keys`, which is also
 * what the card is given a stop of its own for.
 *
 * Which card has it is not a question that has to be answered. Every card is
 * drawn at the one size — it is the reader's eyesight being answered and not
 * this file's — so only whether one of them has it matters.
 *
 * Listened for on the window, and taken whether or not a card answers it,
 * because both presses belong to the webview until something says otherwise and
 * what it does with them is nothing this window offers. A plus is Ctrl and a
 * shifted semicolon on a Japanese keyboard, which is what WebKit opens its
 * symbol chooser on; a minus scales the whole window on Windows. Refusing the
 * default is what keeps the two presses to the reading and nothing else.
 */
export function useReadingKeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const by = stepOf(event);
      if (by === 0) return;
      event.preventDefault();
      if (reading(event.target)) resize(by);
    };

    // Captured on the way down: whatever is being typed into — a terminal, a
    // reading — sees the press only if this window has no use for it.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
