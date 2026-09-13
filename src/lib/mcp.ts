import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const REPORT_EVENT = "mcp:report";

export type Step = {
  title: string;
  /** No in-progress state: the first unfinished step is the one in hand. */
  done: boolean;
};

export type Report = {
  doing: string;
  steps: Step[];
};

export type Reported = {
  id: string;
  report: Report | null;
};

export function servingNow(): Promise<number | null> {
  return invoke<number | null>("mcp_serving");
}

export function serve(): Promise<number> {
  return invoke<number>("mcp_serve");
}

export function stopServing(): Promise<void> {
  return invoke<void>("mcp_stop");
}

export function reportsNow(): Promise<Reported[]> {
  return invoke<Reported[]>("mcp_reports");
}

export type Agent = "claude" | "codex";

export type Setup = {
  agent: Agent;
  line: string;
};

/** Asked again whenever the server moves: one of the lines embeds the port. */
export function setups(): Promise<Setup[]> {
  return invoke<Setup[]>("mcp_setups");
}

export function install(agent: Agent): Promise<string> {
  return invoke<string>("mcp_install", { agent });
}

export function onReport(next: (reported: Reported) => void): Promise<UnlistenFn> {
  return listen<Reported>(REPORT_EVENT, (event) => next(event.payload));
}
