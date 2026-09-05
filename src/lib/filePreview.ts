/** The private browser drag payload used by file rows in the sidebar. */
export const FILE_DRAG_TYPE = "application/x-totex-file";

/**
 * What a card is showing of its file.
 *
 * `text` and `diff` are the same card two ways, and the header switches between
 * them. `markdown` and `picture` are cards of their own: a drawing stands
 * beside the file it is of rather than in place of it, so the two are read
 * against each other — except for a file that is nothing but a picture, which
 * opens as one because there is no reading of it to stand beside.
 */
export type FilePreviewView = "text" | "diff" | "markdown" | "picture" | "settings";

/** One request to put a file card on the canvas. */
export type FilePreviewRequest = {
  id: number;
  path: string;
  /** Client coordinates of a drop, or null to open in the viewport centre. */
  at: { x: number; y: number } | null;
  /** What the card opens showing. Worked out from the file unless something
   *  asked for a drawing of it. */
  view?: FilePreviewView;
  /**
   * The card this one was opened from, which it stands beside.
   *
   * Beside rather than at a point: the card it came from is the thing it is
   * being read against, and where that card is standing — on the canvas or
   * pinned over it, at whatever size it was dragged to — is the whole of where
   * this one goes. See `useFilePreviewPlacing`.
   */
  beside?: number;
};

/**
 * The pictures a card draws, and what each one is drawn as.
 *
 * What the window can put in front of somebody, which is what the engine under
 * it can draw: the formats every browser has taken for years, and the two that
 * arrived with the last of them. Nothing here is decoded by this app — the
 * bytes are handed to the engine as they came off the disk — so a format is on
 * this list exactly when the engine knows it.
 */
const PICTURES: Record<string, string> = {
  ".png": "image/png",
  ".apng": "image/apng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/**
 * The files that are drawn as well as read.
 *
 * Both markdown and SVG are typed by somebody: a card of one is its text, with
 * the drawing standing beside it — which is what the preview button on the
 * header opens, and what `previewView` says the shape of.
 */
const WRITTEN = /\.(md|markdown|mdx|svg)$/i;

/** What the bytes of a file are drawn as, or null for one that is not a
 *  picture at all. */
export function pictureType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? null : (PICTURES[path.slice(dot).toLowerCase()] ?? null);
}

/**
 * Whether a picture is drawn from lines rather than from pixels.
 *
 * Which is what says how large it may be drawn: a drawing has nothing in it to
 * blow up, so it is given the whole of the card it is in and drawn again at
 * whatever size that is, and a photograph is held to its own size.
 */
export function vector(path: string): boolean {
  return pictureType(path) === "image/svg+xml";
}

/** Whether a file is one there is a drawing of to open beside it. */
export function previewable(path: string): boolean {
  return WRITTEN.test(path);
}

/** What the drawing of a file is, for the card opened beside it. */
export function previewView(path: string): FilePreviewView {
  return pictureType(path) === null ? "markdown" : "picture";
}

/**
 * What a card of a file opens showing.
 *
 * A picture, where the file is one and nothing else — there is no reading of a
 * PNG, and a card of one that opened on its bytes would be a card of nothing.
 * Everything else opens as its text, an SVG included: it is a file somebody
 * wrote, and the drawing of it is a press away.
 */
export function openingView(path: string): FilePreviewView {
  return pictureType(path) !== null && !previewable(path) ? "picture" : "text";
}

/**
 * Whether a card showing this is a drawing of its file rather than a reading of
 * it.
 *
 * There is nothing in such a card to type into, no patch to turn it over to,
 * and no preview to open from it — it is the preview.
 */
export function drawn(view: FilePreviewView): boolean {
  return view === "markdown" || view === "picture" || view === "settings";
}

/** The gear owns one ordinary file card outside the drop request sequence. */
export const SETTINGS_REQUEST_ID = -1;
