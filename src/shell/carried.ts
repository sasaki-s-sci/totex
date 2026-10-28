/** Workspace roots and sidebar explorers that survive closing the process. */
// Named for the update it was first kept for; a program before this one still writes it there.
export const CARRIED = "totex.relaunch";

// Terminals are recovered from the service; file IDs and page layout belong to the live process.
export const CARRIES = ["window.roots", "window.foldersOpen", "folders.panes"] as const;

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
