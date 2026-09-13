export type Grid = { rows: number; cols: number };

const grids = new Map<string, Grid>();
const listeners = new Map<string, Set<() => void>>();

export function gridOf(sessionId: string): Grid | null {
  return grids.get(sessionId) ?? null;
}

/**
 * One terminal measures and tells the pty; every other drawing of the shell follows that grid, else
 * the last to resize wins each frame.
 */
export function tellGrid(sessionId: string, grid: Grid): void {
  const held = grids.get(sessionId);
  if (held && held.rows === grid.rows && held.cols === grid.cols) return;
  grids.set(sessionId, grid);
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

export function subscribeGrid(sessionId: string, listener: () => void): () => void {
  let held = listeners.get(sessionId);
  if (!held) {
    held = new Set();
    listeners.set(sessionId, held);
  }
  held.add(listener);
  return () => {
    held.delete(listener);
    if (held.size === 0) listeners.delete(sessionId);
  };
}
