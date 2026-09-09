/** Stable host for replaceable rendering expressions. It never reloads the document or replaces React. */

import { contract } from "virtual:ephemeral-identity";
import { contract as shellContract } from "virtual:shell-identity";
import {
  createElement,
  type Key,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import * as jsx from "react/jsx-runtime";
import { flushSync } from "react-dom";

type Bindings = Record<string, unknown>;
type View = (bindings: Bindings) => ReactNode;
type Manifest = {
  schema: number;
  version: string;
  contract: string;
  viewsContract?: string;
  entry: string;
  styles: string[];
  views: string[];
};

let active: Record<string, View> = {};
let revision = 0;
let version = "";
let swapping = false;
const listeners = new Set<() => void>();
const mounted = new Map<object, { id: string; bindings: Bindings }>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => revision;
const host = globalThis as typeof globalThis & { __TOTEX_VIEWS__?: { jsx: typeof jsx } };
host.__TOTEX_VIEWS__ = { jsx };

function ViewSlot({ id, bindings }: { id: string; bindings: Bindings }) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const slot = useRef({});
  useLayoutEffect(() => {
    const key = slot.current;
    mounted.set(key, { id, bindings });
    return () => {
      mounted.delete(key);
    };
  }, [id, bindings]);
  const view = active[id];
  if (!view) throw new Error(`Missing rendering expression: ${id}`);
  return view(bindings);
}

export function renderEphemeral(id: string, bindings: Bindings, key?: Key | null): ReactNode {
  return createElement(ViewSlot, { id, bindings, key });
}

export function ephemeralIdentity() {
  return { contract, version };
}

function asset(path: string): string {
  if (!/^assets\/[\w./-]+$/.test(path) || path.split("/").includes("..")) {
    throw new Error("Invalid ephemeral asset path");
  }
  return new URL(`/${path}`, location.href).href;
}

async function style(path: string): Promise<HTMLLinkElement> {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.media = "not all";
  link.href = asset(path);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      link.remove();
      reject(new Error("Stylesheet timed out"));
    }, 30_000);
    link.onload = () => {
      clearTimeout(timer);
      resolve(link);
    };
    link.onerror = () => {
      clearTimeout(timer);
      link.remove();
      reject(new Error("Stylesheet failed"));
    };
    document.head.append(link);
  });
}

/** Validate and load everything before changing a single mounted view or stylesheet. */
export async function swapEphemeral(expected?: string): Promise<() => void> {
  if (import.meta.env.DEV) {
    if (expected) throw new Error("Release updates require an installed build");
    return () => {};
  }
  if (swapping) throw new Error("An ephemeral update is already in progress");
  swapping = true;
  const loaded: HTMLLinkElement[] = [];
  try {
    const response = await fetch(`/ephemeral.json?at=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Ephemeral manifest is unavailable");
    const next: Manifest = await response.json();
    if (
      (next.schema !== 1 && next.schema !== 2) ||
      (next.schema === 2 && next.contract !== shellContract) ||
      (next.viewsContract ?? next.contract) !== contract ||
      (expected && next.version !== expected) ||
      !Array.isArray(next.views) ||
      !Array.isArray(next.styles)
    ) {
      throw new Error("This ephemeral release requires a different persistent runtime");
    }
    const module = await import(/* @vite-ignore */ asset(next.entry));
    const views = module.views as Record<string, View>;
    if (
      !views ||
      next.views.some((id) => typeof views[id] !== "function") ||
      Object.keys(active).some((id) => !next.views.includes(id))
    ) {
      throw new Error("The ephemeral release does not implement every mounted view");
    }
    // Rendering expressions are pure. Check their current inputs before touching the live tree.
    for (const { id, bindings } of mounted.values()) views[id](bindings);
    // Wait for all styles, including failed loads, before cleaning up a refused candidate.
    const results = await Promise.allSettled(
      next.styles.map(async (path) => {
        const link = await style(path);
        loaded.push(link);
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Stylesheet failed");
    const previous = [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ].filter((link) => !loaded.includes(link) && new URL(link.href).origin === location.origin);
    const oldViews = active;
    const oldVersion = version;
    // The existing React fibers, refs, terminal instances and focused DOM nodes stay mounted.
    flushSync(() => {
      active = views;
      version = next.version;
      for (const link of loaded) link.media = "all";
      revision += 1;
      for (const listener of listeners) listener();
    });
    for (const link of previous) link.remove();
    return () => {
      flushSync(() => {
        active = oldViews;
        version = oldVersion;
        for (const link of previous) document.head.append(link);
        for (const link of loaded) link.remove();
        revision += 1;
        for (const listener of listeners) listener();
      });
    };
  } catch (error) {
    for (const link of loaded) link.remove();
    throw error;
  } finally {
    swapping = false;
  }
}
