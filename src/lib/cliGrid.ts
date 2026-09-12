/**
 * How many rows and columns each shell has been told it has.
 *
 * One terminal answers for a shell's size — the one whose box the rows are
 * fitted to, which tells the pty — and any other drawing of the same shell
 * follows it: a shell drawn at two sizes at once is a shell being told two
 * sizes, and the last word wins every frame. So the one that measures says
 * what it measured here, and the one that follows reads it and draws that many
 * rows and columns, however small they have to be to fit.
 */

export type Grid = { rows: number; cols: number };

const grids = new Map<string, Grid>();
const listeners = new Map<string, Set<() => void>>();

/** What the shell was last told, or nothing while no terminal has measured it. */
export function gridOf(sessionId: string): Grid | null {
  return grids.get(sessionId) ?? null;
}

/** Said by the terminal that told the shell. */
export function tellGrid(sessionId: string, grid: Grid): void {
  const held = grids.get(sessionId);
  if (held && held.rows === grid.rows && held.cols === grid.cols) return;
  grids.set(sessionId, grid);
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

/** Heard by the terminals that follow. */
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
