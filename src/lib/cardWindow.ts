/**
 * A card torn off the window and standing in a window of its own.
 *
 * A pinned card dragged out past the edge of the window keeps going: a window
 * the size of the card is opened under the pointer, the card is drawn in it,
 * and the drag carries on with the window in hand instead. Dragged back in
 * and let go over the canvas, the window closes and the card is pinned where
 * it was dropped. Both halves are the same app in the same process, so what
 * passes between them is a description of the card and nothing heavier — the
 * file is read again by whichever window is drawing it, and what was being
 * typed into it is carried across as the draft.
 *
 * The two windows talk in events, and this is the whole of the vocabulary. A
 * card window says hello once it is listening; the main window answers with
 * the seed; the card window says when it has been drawn and shown, which is
 * the moment the main window stops drawing its own copy; and it says where it
 * was let go, which the main window turns into a card again or ignores.
 *
 * `useCardWindows` is the main window's half and `CardWindow` the other.
 */

import type { FilePreviewView } from "./filePreview";

/** What every card window's label starts with; the rest is the moment it was made. */
export const CARD_LABEL = "card-";

/** Said by a card window once it is listening for its seed. */
export const CARD_HELLO = "card:hello";
/** Said to one card window: what it is to draw. */
export const CARD_SEED = "card:seed";
/** Said by a card window once the card is drawn and the window is on screen. */
export const CARD_SHOWN = "card:shown";
/** Said by a card window when it was let go, or asked to go back. */
export const CARD_DROPPED = "card:dropped";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** What a card holds while it is being typed into — `useDraft`'s own record. */
export type CardDraft = { text: string; disk: string | null; kept: string | null; dirty: boolean };

/**
 * What one window tells another about a card: enough to draw it again, and
 * nothing that can be read off the disk instead.
 */
export type CardSeed = {
  requestId: number;
  path: string;
  view: FilePreviewView;
  collapsed: boolean;
  /** The card's own size, before the scale it is drawn at. */
  box: Size;
  /** How large it is drawn — the canvas zoom it was pinned at. */
  scale: number;
  /** What was being typed into it, when that is more than the file holds. */
  draft?: CardDraft;
};

export type Hello = { label: string };
export type Seeded = { label: string; seed: CardSeed };
export type Shown = { label: string };
export type Dropped = {
  label: string;
  seed: CardSeed;
  /** Where the pointer was let go, on screen, in CSS pixels. */
  at: Point;
  /** Where the pointer took hold of the window, from its top-left corner. */
  grab: Point;
  /** Put back whether or not it is over the canvas: the pin was pressed. */
  force?: boolean;
};

export function isCardLabel(label: string): boolean {
  return label.startsWith(CARD_LABEL);
}

/** A label no other window has: the moment, and a little noise for two made in it. */
export function cardLabel(now = Date.now(), noise = Math.random()): string {
  return `${CARD_LABEL}${now.toString(36)}-${Math.floor(noise * 0xffff).toString(36)}`;
}

/** Whether a point in a window's own pixels is outside the window. */
export function outsideWindow(at: Point, size: Size): boolean {
  return at.x < 0 || at.y < 0 || at.x >= size.width || at.y >= size.height;
}

/** Where a thing whose corner the pointer took hold of at `grab` stands now. */
export function corner(at: Point, grab: Point): Point {
  return { x: at.x - grab.x, y: at.y - grab.y };
}

/**
 * A point on screen said in a pane's own pixels.
 *
 * `origin` is where the window's page starts on screen and `pane` where the
 * pane starts on the page, both in CSS pixels — which is what a screen
 * position on a pointer event is in, and what a window's physical position
 * comes to once divided by its scale.
 */
export function inPane(screen: Point, origin: Point, pane: Point): Point {
  return { x: screen.x - origin.x - pane.x, y: screen.y - origin.y - pane.y };
}

/** Whether a point in a pane's pixels is on the pane. */
export function onPane(at: Point, pane: Size): boolean {
  return !outsideWindow(at, pane);
}
