import { useEffect, useState } from "react";

import { type Answer, type Change, directoryChanges } from "./api";

export type { Answer, Change };

// Polled rather than watched: git answers by running, and the clock only covers what happened out
// of sight.
const EVERY_MS = 6000;

// A burst of writes settles into one reading.
const SETTLE_MS = 200;

// A module rather than a context: a level hears about its own directory and nothing else.
const open = new Map<string, Set<() => void>>();

// Kept by identity; see `settle`.
const held = new Map<string, Answer>();

const NOTHING: Answer = { changed: {}, ignored: [], allIgnored: false };

let pending: ReturnType<typeof setTimeout> | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let reading = false;

export function changesIn(path: string): Answer {
  return held.get(path) ?? NOTHING;
}

/** `onChange` fires only when this directory's own answer moves. */
export function watchChanges(path: string, onChange: () => void): () => void {
  let bucket = open.get(path);
  if (!bucket) {
    bucket = new Set();
    open.set(path, bucket);
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

/** Which directory moved is not passed on: one write can colour a folder elsewhere. */
export function refreshChanges() {
  schedule();
}

export function useDirectoryChanges(path: string): Answer {
  const [answer, setAnswer] = useState<Answer>(() => changesIn(path));

  useEffect(() => {
    setAnswer(changesIn(path));
    return watchChanges(path, () => setAnswer(changesIn(path)));
  }, [path]);

  return answer;
}

function start() {
  if (clock || open.size === 0) return;
  clock = setInterval(() => {
    if (document.visibilityState === "visible" && document.hasFocus()) read();
  }, EVERY_MS);
  // Coming back to the window is worth a reading of its own.
  window.addEventListener("focus", read);
}

function stop() {
  if (open.size > 0 || !clock) return;
  clearInterval(clock);
  clock = null;
  window.removeEventListener("focus", read);
}

// Deferred: levels mount one after another in one render, and a burst of writes is one answer.
function schedule() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    read();
  }, SETTLE_MS);
}

function read() {
  // One reading at a time.
  if (reading || open.size === 0) return;
  reading = true;
  directoryChanges([...open.keys()])
    .then(settle)
    // A directory that would not answer keeps what it last said.
    .catch(() => undefined)
    .finally(() => {
      reading = false;
    });
}

/**
 * Missing from the answer means git would not read it, so it keeps what it had; present and empty
 * clears it.
 */
function settle(answers: Record<string, Answer>) {
  for (const [path, answer] of Object.entries(answers)) {
    const bucket = open.get(path);
    if (!bucket) continue;

    if (same(held.get(path) ?? NOTHING, answer)) continue;
    held.set(path, answer);
    for (const onChange of bucket) onChange();
  }
}

function same(left: Answer, right: Answer): boolean {
  return (
    left.allIgnored === right.allIgnored &&
    sameNames(left.ignored, right.ignored) &&
    sameChanges(left.changed, right.changed)
  );
}

/** The ignore list comes back in git's own order, which is stable. */
function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, at) => name === right[at]);
}

// By name: two maps holding the same thing can be walked in two orders.
function sameChanges(left: Record<string, Change>, right: Record<string, Change>): boolean {
  const names = Object.keys(left);
  if (names.length !== Object.keys(right).length) return false;
  return names.every((name) => Object.hasOwn(right, name) && left[name] === right[name]);
}
