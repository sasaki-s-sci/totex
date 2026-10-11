import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const SESSION_EVENT = "overseer:session";
export const STATUS_EVENT = "overseer:status";

export type Overseen = {
  id: string;
  /** One line about that terminal, written by the overseer; null once it has nothing to say. */
  status: string | null;
  replyKey?: string | null;
};

const WSL = /^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)/i;

/**
 * Which overseer a terminal belongs to: the WSL distribution its folder is in, or null for this
 * machine. Session ids begin with their folder, so an id answers the same as its cwd.
 */
export function scopeOf(pathOrId: string): string | null {
  return WSL.exec(pathOrId)?.[1] ?? null;
}

/** Every running overseer's session, one per environment at most. */
export function overseerSessions(): Promise<string[]> {
  return invoke<string[]>("overseer_sessions");
}

export function onOverseer(next: (ids: string[]) => void): Promise<UnlistenFn> {
  return listen<string[]>(SESSION_EVENT, (event) => next(event.payload));
}

export function statusesNow(): Promise<Overseen[]> {
  return invoke<Overseen[]>("overseer_statuses");
}

export function onStatus(next: (overseen: Overseen) => void): Promise<UnlistenFn> {
  return listen<Overseen>(STATUS_EVENT, (event) => next(event.payload));
}

export function overseerDistros(): Promise<string[]> {
  return invoke<string[]>("overseer_distros");
}

export function startOverseer(distro: string | null = null): Promise<string> {
  return invoke<string>("overseer_start", { distro });
}

export function stopOverseer(distro: string | null = null): Promise<void> {
  return invoke<void>("overseer_stop", { distro });
}
