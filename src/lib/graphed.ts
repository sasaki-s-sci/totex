/** How a pane puts a place on the canvas: as the folder it is, or as the one repository it is. */
export type GraphedKind = "folder" | "repository";

/**
 * A folder is drawn as a folder — its row and the terminals round it — and nothing under it is
 * scanned. A repository is scanned alone and drawn with its branches under the row.
 */
export type Graphed = { kind: GraphedKind; root: string };

/** Where a pane stood, kept between runs: the folder it browsed, or the root it listed. */
export type PaneSeed = { kind: GraphedKind; path: string };

// No path on any platform contains NUL, which keeps the join reversible.
const SEPARATOR = "\u0000";

export function graphedKey({ kind, root }: Graphed): string {
  return `${kind}${SEPARATOR}${root}`;
}

export function isGraphedKind(value: unknown): value is GraphedKind {
  return value === "folder" || value === "repository";
}

/**
 * Written by some earlier version as paths alone: read as a claim, not a fact, and a bare path is a
 * folder, which is all a pane could be then.
 */
export function readSeeds(stored: unknown): PaneSeed[] {
  if (!Array.isArray(stored)) return [];
  const seeds: PaneSeed[] = [];
  for (const entry of stored) {
    if (typeof entry === "string") {
      seeds.push({ kind: "folder", path: entry });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const { kind, path } = entry as Partial<PaneSeed>;
    if (isGraphedKind(kind) && typeof path === "string") seeds.push({ kind, path });
  }
  return seeds;
}

/** The same reading for what an earlier front had on the canvas. */
export function readGraphed(stored: unknown): Graphed[] {
  return readSeeds(stored).map(({ kind, path }) => ({ kind, root: path }));
}
