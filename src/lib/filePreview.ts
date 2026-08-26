/** The private browser drag payload used by file rows in the sidebar. */
export const FILE_DRAG_TYPE = "application/x-totex-file";

/**
 * What a card is showing of its file: the file itself, or the patch against the
 * commit under it. The same card either way, and its header is what turns it
 * from the one to the other.
 */
export type FilePreviewView = "text" | "diff";

/** One request to put a file card on the canvas. */
export type FilePreviewRequest = {
  id: number;
  path: string;
  /** Client coordinates of a drop, or null to open in the viewport centre. */
  at: { x: number; y: number } | null;
};
