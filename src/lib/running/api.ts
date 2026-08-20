import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Running } from "../../types/running";

/** Carries the whole picture whenever any part of it moved. */
export const RUNNING_CHANGED_EVENT = "running:changed";

/** One look at the machine, for a panel that has just opened. */
export function scanRunning(): Promise<Running> {
  return invoke("running_scan");
}

/**
 * Starts or stops the sweep behind the event.
 *
 * Asked for by whoever is watching and given up when they stop: reading the
 * process table every couple of seconds is cheap, and doing it for a window
 * nobody is looking at is still not worth doing.
 */
export function watchRunning(on: boolean): Promise<void> {
  return invoke("running_watch", { on });
}

export function onRunningChanged(next: (running: Running) => void): Promise<UnlistenFn> {
  return listen<Running>(RUNNING_CHANGED_EVENT, (event) => next(event.payload));
}
