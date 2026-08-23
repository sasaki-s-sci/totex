import { useEffect, useState } from "react";

import { type Change, directoryChanges } from "./api";

export type { Change };

/**
 * How often the open directories are asked again.
 *
 * Asked rather than watched, for the same reason a branch's rim is: git answers
 * about a directory by running in it, and what is uncommitted moves with the
 * keystrokes of whoever is typing. The clock is slow because it is the second
 * way this is heard — a file written into a directory the column is showing
 * already re-reads that directory, and `refreshChanges` is that re-read saying
 * so. What is left for the clock is everything git was told out of sight: a
 * commit, a checkout, a file written under a folder that is not open.
 */
const EVERY_MS = 6000;

/**
 * How long a burst of writes is allowed to settle before git is asked.
 *
 * Whatever is running in the panel writes a file at a time, and each of those
 * is a directory saying it moved. One reading covers all of them.
 */
const SETTLE_MS = 200;

/**
 * The directories the column has open, and who to tell when one of them moves.
 *
 * A module rather than a context, exactly as in `watch.ts`: every open level
 * subscribes, and running the whole tree through React state would redraw all
 * of it to tell one row that its file changed. A level hears about its own
 * directory and about nothing else.
 */
const open = new Map<string, Set<() => void>>();

/** The last answer for each open directory. Kept by identity — see `settle`. */
const held = new Map<string, ReadonlyMap<string, Change>>();

const NOTHING: ReadonlyMap<string, Change> = new Map();

let pending: ReturnType<typeof setTimeout> | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let reading = false;

/** What became of each entry of `path`, as far as git has been asked. */
export function changesIn(path: string): ReadonlyMap<string, Change> {
  return held.get(path) ?? NOTHING;
}

/**
 * Asks about `path` for as long as the returned function has not been called.
 *
 * `onChange` fires when this directory's own answer moves, and on no other
 * reading: a column with ten levels open is ten answers a tick, and nine of
 * them are usually the same as they were.
 */
export function watchChanges(path: string, onChange: () => void): () => void {
  let bucket = open.get(path);
  if (!bucket) {
    bucket = new Set();
    open.set(path, bucket);
    // A folder that has just been opened is the one being looked at, so it is
    // asked about now rather than at the next tick.
    schedule();
  }
  bucket.add(onChange);
  start();

  return () => {
    const holding = open.get(path);
    if (!holding) return;
    holding.delete(onChange);
    if (holding.size > 0) return;
    open.delete(path);
    held.delete(path);
    stop();
  };
}

/**
 * Says that something on disk moved, so the colours are worth reading again.
 *
 * Called by the level that just re-read its own directory. Which directory it
 * was is not passed on: a file written in one of them can be the reason a
 * folder in another turns orange, and the whole set is one crossing anyway.
 */
export function refreshChanges() {
  schedule();
}

/** What became of each entry of `path`, kept up to date while it is drawn. */
export function useDirectoryChanges(path: string): ReadonlyMap<string, Change> {
  const [changes, setChanges] = useState<ReadonlyMap<string, Change>>(() => changesIn(path));

  useEffect(() => {
    setChanges(changesIn(path));
    return watchChanges(path, () => setChanges(changesIn(path)));
  }, [path]);

  return changes;
}

/** The clock, which runs only while there is something open to ask about. */
function start() {
  if (clock || open.size === 0) return;
  clock = setInterval(() => {
    // Nobody is looking: what is uncommitted can be read when they come back.
    if (document.visibilityState === "visible" && document.hasFocus()) read();
  }, EVERY_MS);
  // Coming back to the window is worth a reading of its own — that is when the
  // answer is most likely to have moved and most likely to be looked at.
  window.addEventListener("focus", read);
}

function stop() {
  if (open.size > 0 || !clock) return;
  clearInterval(clock);
  clock = null;
  window.removeEventListener("focus", read);
}

/**
 * Reads soon, and once.
 *
 * Deferred because levels mount one after another in the same render — opening
 * a folder subscribes it and every folder already open inside it — and because
 * a burst of writes is one answer, not one each.
 */
function schedule() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    read();
  }, SETTLE_MS);
}

function read() {
  // One reading at a time. A tick that arrives while git is still out is a tick
  // with nothing to add, and starting another only slows the first.
  if (reading || open.size === 0) return;
  reading = true;
  directoryChanges([...open.keys()])
    .then(settle)
    // A directory that would not answer keeps whatever it last said. There is
    // no failure to draw here: the column is mostly folders git has never heard
    // of, and a plain row is what one of those looks like.
    .catch(() => undefined)
    .finally(() => {
      reading = false;
    });
}

/**
 * Files the answers, and tells the directories whose own answer moved.
 *
 * A directory that is missing from the answer is one git would not read, which
 * keeps what it had; a directory that is in it and empty is one with nothing
 * uncommitted, which is how colours go away again.
 */
function settle(answers: Record<string, Record<string, Change>>) {
  for (const [path, entries] of Object.entries(answers)) {
    const bucket = open.get(path);
    // Left in the meantime: a folder that was shut while git was out.
    if (!bucket) continue;

    const next = new Map(Object.entries(entries));
    if (same(held.get(path) ?? NOTHING, next)) continue;
    held.set(path, next);
    for (const onChange of bucket) onChange();
  }
}

function same(left: ReadonlyMap<string, Change>, right: ReadonlyMap<string, Change>): boolean {
  if (left.size !== right.size) return false;
  for (const [name, change] of left) {
    if (right.get(name) !== change) return false;
  }
  return true;
}
