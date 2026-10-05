/** One span of the base replaced: what the two texts share at either end is left out of it. */
type Hunk = { from: number; to: number; text: string };

function hunkOf(base: string, next: string): Hunk | null {
  if (base === next) return null;
  const most = Math.min(base.length, next.length);
  let start = 0;
  while (start < most && base[start] === next[start]) start += 1;
  let end = 0;
  while (end < most - start && base[base.length - 1 - end] === next[next.length - 1 - end]) {
    end += 1;
  }
  return { from: start, to: base.length - end, text: next.slice(start, next.length - end) };
}

/**
 * Both edits made to `base`, one in the card and one on disk, or `null` when they meet: each is
 * taken as the one span it changed, and two spans that touch cannot be told which goes first.
 */
export function merge(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours;
  const mine = hunkOf(base, ours);
  const other = hunkOf(base, theirs);
  if (!mine) return theirs;
  if (!other) return ours;
  const [first, second] = mine.from <= other.from ? [mine, other] : [other, mine];
  if (first.to >= second.from) return null;
  return (
    base.slice(0, first.from) +
    first.text +
    base.slice(first.to, second.from) +
    second.text +
    base.slice(second.to)
  );
}

/** Where a caret at `at` in `before` stands once the text is `after`: carried past what moved ahead of it. */
export function carried(at: number, before: string, after: string): number {
  const hunk = hunkOf(before, after);
  if (!hunk || at <= hunk.from) return at;
  if (at >= hunk.to) return at + hunk.text.length - (hunk.to - hunk.from);
  return hunk.from + hunk.text.length;
}
