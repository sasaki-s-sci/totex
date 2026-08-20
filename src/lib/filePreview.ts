/** The private browser drag payload used by file rows in the sidebar. */
export const FILE_DRAG_TYPE = "application/x-totex-file";

/** One request to put a file card on the canvas. */
export type FilePreviewRequest = {
  id: number;
  path: string;
  /** Client coordinates of a drop, or null to open in the viewport centre. */
  at: { x: number; y: number } | null;
};
