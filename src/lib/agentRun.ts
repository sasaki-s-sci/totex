import { invoke } from "@tauri-apps/api/core";

/** A chunk of an agent's output, as it arrives. */
export const AGENT_DATA_EVENT = "agent:data";
/** One run of an agent finished — with how it went. */
export const AGENT_EXIT_EVENT = "agent:exit";

export type AgentChunk = { id: string; data: string };
export type AgentEnded = { id: string; ok: boolean; code: number | null };

/**
 * Runs one turn of an agent in a worktree.
 *
 * Returns as soon as the process is up; everything it says comes back on
 * `agent:data`, and `agent:exit` says it is done.
 */
export function runAgent(id: string, cwd: string, program: string, args: string[]): Promise<void> {
  return invoke("agent_send", { id, cwd, program, args });
}

/** Stops a run that is still going. Doing this to a finished one is harmless. */
export function cancelAgent(id: string): Promise<void> {
  return invoke("agent_cancel", { id });
}

// Print mode is not a terminal, but not every agent has noticed; what does slip
// through would otherwise be shown as literal escape sequences.
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are the point
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function plainText(value: string): string {
  return value.replace(ANSI, "");
}
