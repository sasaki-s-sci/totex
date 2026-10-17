import { invoke } from "@tauri-apps/api/core";
import { useLayoutEffect, useState } from "react";
import { connection } from "./bridge";
import { CARRIED, CARRIES, pickCarried, readCarried } from "./carried";
import type { Snapshot } from "./protocol";

// Keys and value schemas are an explicit frontend handoff contract, independent of hook order.
const values: Record<string, unknown> = structuredClone(connection?.snapshot?.values ?? {});
const readers = new Map<string, () => unknown | Promise<unknown>>();
export function readOnSnapshot(key: string, read: () => unknown | Promise<unknown>): () => void {
  readers.set(key, read);
  return () => {
    readers.delete(key);
  };
}
export function frontValue<T>(key: string): T | undefined {
  return values[key] as T | undefined;
}
export function keepFrontValue(key: string, value: unknown): void {
  values[key] = value;
  if (carries(key)) keepSoon();
}

/** Asked of whatever holds it now, or what was last kept under the key. */
export async function readFrontValue<T>(key: string): Promise<T | undefined> {
  const read = readers.get(key);
  return (read ? await read() : values[key]) as T | undefined;
}
export async function snapshot(): Promise<Snapshot> {
  for (const [key, read] of readers) values[key] = await read();
  return { schema: 1, values: structuredClone(values) };
}
function carries(key: string): boolean {
  return (CARRIES as readonly string[]).includes(key);
}

// Written as it changes rather than on the way out: closing the window ends this process with no
// time to ask anything of the service, and neither does the machine going down.
const KEEP_AFTER_MS = 400;
let keeping = false;
let kept: string | null = null;
let soon: ReturnType<typeof setTimeout> | undefined;

function keepSoon(): void {
  if (!keeping || soon !== undefined) return;
  soon = setTimeout(() => {
    soon = undefined;
    void keepCarried();
  }, KEEP_AFTER_MS);
}

/** Hands the graph to the service now, unless the service already holds this much of it. */
async function keepCarried(): Promise<void> {
  const value = pickCarried(values);
  const json = JSON.stringify(value);
  if (json === kept) return;
  kept = json;
  await invoke("persistent_put", { name: CARRIED, value }).catch(() => {
    if (kept === json) kept = null;
  });
}

/** Hands the graph to the service before a program update ends this process; see `carried`. */
export async function carryAcrossRestart(): Promise<void> {
  clearTimeout(soon);
  soon = undefined;
  kept = null;
  await keepCarried();
}

/**
 * Takes back what the last front left, once, before anything renders, and from then on keeps it as
 * it changes. A frame handed state by the shell already holds the newer values. A store that will
 * not answer is never written either, so an empty canvas does not replace what it holds.
 */
export async function takeCarried(): Promise<void> {
  if (!connection?.snapshot) {
    let stored: unknown;
    try {
      stored = await invoke<unknown>("persistent_get", { name: CARRIED });
    } catch {
      return;
    }
    for (const [key, value] of Object.entries(readCarried(stored))) {
      if (!Object.hasOwn(values, key)) values[key] = value;
    }
  }
  keeping = true;
  window.addEventListener("pagehide", () => void keepCarried());
}

export function useFrontState<T>(key: string, initial: T | (() => T)) {
  const state = useState<T>(() =>
    Object.hasOwn(values, key)
      ? (values[key] as T)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial,
  );
  useLayoutEffect(() => {
    values[key] = state[0];
    if (carries(key)) keepSoon();
  }, [key, state[0]]);
  return state;
}
