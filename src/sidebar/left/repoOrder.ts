import type { FoundRepository } from "../../folder/api";

/**
 * One alphabet, whatever the case: `Blender` stands between `abc` and `notes`. Spelt out rather
 * than left to the locale so the rows stand in the order the backend lists them in, and the
 * graph lays them out in, on every webview alike.
 */
export function byName(a: FoundRepository, b: FoundRepository): number {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

/** In its place among the rows held, or the rows as they were when it is one of them already. */
export function withFound(held: FoundRepository[], found: FoundRepository): FoundRepository[] {
  if (held.some((row) => row.path === found.path)) return held;
  const at = held.findIndex((row) => byName(found, row) < 0);
  return at < 0 ? [...held, found] : [...held.slice(0, at), found, ...held.slice(at)];
}
