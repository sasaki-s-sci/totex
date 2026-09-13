import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const DOING_EVENT = "pty:doing";

export type Doing = "idle" | "running" | "agent" | "working";

export type Doings = {
  id: string;
  doing: Doing;
};

/**
 * Sent, not asked for: a shell at its prompt never redraws, so listening alone would draw nothing.
 */
export function doingNow(): Promise<Doings[]> {
  return invoke<Doings[]>("pty_doing");
}

export function onDoing(next: (doings: Doings) => void): Promise<UnlistenFn> {
  return listen<Doings>(DOING_EVENT, (event) => next(event.payload));
}
