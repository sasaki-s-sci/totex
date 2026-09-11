import { useLayoutEffect, useState } from "react";
import { connection } from "./bridge";
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
/**
 * One value as it stands now: asked of whatever holds it, the way the whole
 * snapshot is, or what was last kept under the key when nothing reads it.
 */
export async function readFrontValue<T>(key: string): Promise<T | undefined> {
  const read = readers.get(key);
  return (read ? await read() : values[key]) as T | undefined;
}
export async function snapshot(): Promise<Snapshot> {
  for (const [key, read] of readers) values[key] = await read();
  return { schema: 1, values: structuredClone(values) };
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
