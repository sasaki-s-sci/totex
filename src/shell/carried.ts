/**
 * What of the front's state outlives the restart a program update takes.
 *
 * A live handoff passes every value from one frame to the next, but installing a program ends this
 * process, and the page the installed program opens would start from nothing: an empty canvas, the
 * explorers back at their seeds. So before the restart the graph is handed to the service, which
 * outlives both windows, under one document name, and the first page up takes it back once.
 */
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
