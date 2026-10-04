import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const SESSION_EVENT = "overseer:session";
export const STATUS_EVENT = "overseer:status";

export type Overseen = {
  id: string;
  /** One line about that terminal, written by the overseer; null once it has nothing to say. */
  status: string | null;
};

export function overseerNow(): Promise<string | null> {
  return invoke<string | null>("overseer_session");
}

export function onOverseer(next: (id: string | null) => void): Promise<UnlistenFn> {
  return listen<string | null>(SESSION_EVENT, (event) => next(event.payload));
}

export function statusesNow(): Promise<Overseen[]> {
  return invoke<Overseen[]>("overseer_statuses");
}

export function onStatus(next: (overseen: Overseen) => void): Promise<UnlistenFn> {
  return listen<Overseen>(STATUS_EVENT, (event) => next(event.payload));
}
