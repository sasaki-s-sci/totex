/** The private browser drag payload used by file rows in the sidebar. */
export const FILE_DRAG_TYPE = "application/x-totex-file";

/**
 * What a card is showing of its file.
 *
 * `text` and `diff` are the same card two ways, and the header switches between
 * them. `markdown` is a card of its own: a preview stands beside the file it is
 * of rather than in place of it, so the two are read against each other.
 */
export type FilePreviewView = "text" | "diff" | "markdown";

/** One request to put a file card on the canvas. */
export type FilePreviewRequest = {
  id: number;
  path: string;
  /** Client coordinates of a drop, or null to open in the viewport centre. */
  at: { x: number; y: number } | null;
  /** What the card opens showing. Text unless something asked for a preview. */
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

/** Whether a file is one a preview can be drawn of. Markdown for now, which is
 *  what the window is asked to preview. */
export function previewable(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}
