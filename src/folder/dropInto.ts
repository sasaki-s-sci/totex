/**
 * Which folder a drop on the window would land in.
 *
 * A native drop does not become a browser drop event in a Tauri webview: what
 * arrives is a point on the window and a list of paths, with nothing said about
 * what was under the pointer. So the rows say it themselves — every one that
 * can take a drop carries the folder it would put it in — and the point is
 * asked of the document, which is the one thing that knows what is drawn where.
 *
 * A file's row names the directory listing it rather than the file, the same
 * way its context menu makes a new file beside it rather than inside it: what
 * is dropped on a listing goes into the folder that listing is of.
 */

/** The attribute a row carries to name the folder a drop on it lands in. */
export const DROP_INTO = "data-drop-into";

/** The folder under a point on the window, or null where nothing there takes a
 *  drop — the canvas, which opens what is dropped on it instead. */
export function folderUnder(x: number, y: number): string | null {
  return (
    document.elementFromPoint(x, y)?.closest(`[${DROP_INTO}]`)?.getAttribute(DROP_INTO) ?? null
  );
}
