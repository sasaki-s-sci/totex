import { invoke } from "@tauri-apps/api/core";
import { useLayoutEffect, useState } from "react";
import { connection } from "./bridge";
import { CARRIED, pickCarried, readCarried } from "./carried";
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
/** Hands the graph to the service before a program update ends this process; see `carried`. */
export async function carryAcrossRestart(): Promise<void> {
  await invoke("persistent_put", { name: CARRIED, value: pickCarried(values) });
}

/** Forgets what was carried, so an ordinary launch never starts from it. */
export async function dropCarried(): Promise<void> {
  await invoke("persistent_put", { name: CARRIED, value: null }).catch(() => undefined);
}

/**
 * Takes back what the program before this one carried, once, before anything renders. A frame
 * handed state by the shell already holds the newer values.
 */
export async function takeCarried(): Promise<void> {
  if (connection?.snapshot) return;
  let kept: unknown;
  try {
    kept = await invoke<unknown>("persistent_get", { name: CARRIED });
  } catch {
    return;
  }
  if (kept === null || kept === undefined) return;
  await dropCarried();
  for (const [key, value] of Object.entries(readCarried(kept))) {
    if (!Object.hasOwn(values, key)) values[key] = value;
  }
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
  }, [key, state[0]]);
  return state;
}
