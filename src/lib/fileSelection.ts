import { isInside } from "../folder/format.ts";

export type SelectionEntry = { path: string; isDir: boolean };

/** A selected folder already includes its children; operate on each tree only once. */
export function topLevelEntries(entries: readonly SelectionEntry[]): SelectionEntry[] {
  const unique = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
  return unique.filter(
    (entry) =>
      !unique.some(
        (parent) => parent !== entry && parent.isDir && isInside(parent.path, entry.path),
      ),
  );
}
