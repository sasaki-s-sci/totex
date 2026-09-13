// A native drop is a point and paths; each row carries the folder it would drop into, and the
// document is asked what is under the point.

export const DROP_INTO = "data-drop-into";

export function folderUnder(x: number, y: number): string | null {
  return (
    document.elementFromPoint(x, y)?.closest(`[${DROP_INTO}]`)?.getAttribute(DROP_INTO) ?? null
  );
}
