import type { FilePreviewView } from "./filePreview";

// Protocol between the main window and a window holding one torn-off card: hello,
// seed, shown, dropped. Only a description crosses; whichever window draws the card re-reads the
// file.
export const CARD_LABEL = "card-";

export const CARD_HELLO = "card:hello";
export const CARD_SEED = "card:seed";
export const CARD_SHOWN = "card:shown";
export const CARD_DROPPED = "card:dropped";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export type CardDraft = { text: string; disk: string | null; kept: string | null; dirty: boolean };

export type CardSeed = {
  requestId: number;
  path: string;
  view: FilePreviewView;
  collapsed: boolean;
  box: Size;
  scale: number;
  draft?: CardDraft;
};

export type Hello = { label: string };
export type Seeded = { label: string; seed: CardSeed };
export type Shown = { label: string };
export type Dropped = {
  label: string;
  seed: CardSeed;
  at: Point;
  grab: Point;
  /** Put back even when off the canvas: the pin was pressed. */
  force?: boolean;
};

export function isCardLabel(label: string): boolean {
  return label.startsWith(CARD_LABEL);
}

export function cardLabel(now = Date.now(), noise = Math.random()): string {
  return `${CARD_LABEL}${now.toString(36)}-${Math.floor(noise * 0xffff).toString(36)}`;
}

export function outsideWindow(at: Point, size: Size): boolean {
  return at.x < 0 || at.y < 0 || at.x >= size.width || at.y >= size.height;
}

export function corner(at: Point, grab: Point): Point {
  return { x: at.x - grab.x, y: at.y - grab.y };
}

/** `origin` and `pane` are in CSS pixels, as a pointer event's screen position is. */
export function inPane(screen: Point, origin: Point, pane: Point): Point {
  return { x: screen.x - origin.x - pane.x, y: screen.y - origin.y - pane.y };
}

export function onPane(at: Point, pane: Size): boolean {
  return !outsideWindow(at, pane);
}
