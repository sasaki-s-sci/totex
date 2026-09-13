import { invoke } from "@tauri-apps/api/core";

/** Fetched per commit on demand: bodies are too heavy to ship with every scan. */
export function commitMessage(repoId: string, oid: string): Promise<string> {
  return invoke("commit_message", { repoId, oid });
}
