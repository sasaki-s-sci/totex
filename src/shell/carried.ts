/**
 * What of the front's state outlives the process: the restart a program update takes, and the
 * window being closed and opened again.
 *
 * A live handoff passes every value from one frame to the next, but installing a program or closing
 * the window ends this process, and the next page would start from nothing: an empty canvas, the
 * explorers back at their seeds. So the graph is kept in the service's store, which is on disk, as
 * it changes, and the first page of every launch takes it back.
 */
// Named for the update it was first kept for; a program before this one still writes it there.
export const CARRIED = "totex.relaunch";

// Plain JSON, and all of it the graph. Terminals are found running again, or are gone with a
// replaced service; scanned readings are read again rather than drawn stale.
export const CARRIES = [
  "window.roots",
  "window.foldersOpen",
  "folders.panes",
  "canvas.viewport",
] as const;

/** The document to keep: only the carried keys this front holds. */
export function pickCarried(values: Readonly<Record<string, unknown>>): {
  values: Record<string, unknown>;
} {
  const picked: Record<string, unknown> = {};
  for (const key of CARRIES) if (Object.hasOwn(values, key)) picked[key] = values[key];
  return { values: picked };
}

/**
 * Read as a claim: an earlier program wrote it, or nothing did. Only carried keys come back, each
 * still read by its owner the way a handed-off value is.
 */
export function readCarried(kept: unknown): Record<string, unknown> {
  if (!kept || typeof kept !== "object") return {};
  const values = (kept as { values?: unknown }).values;
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  const read: Record<string, unknown> = {};
  for (const key of CARRIES) {
    if (Object.hasOwn(values, key)) read[key] = (values as Record<string, unknown>)[key];
  }
  return read;
}
