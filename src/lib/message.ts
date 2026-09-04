/**
 * What one commit says, in full.
 *
 * The graph is handed every commit's subject with the rest of the repository,
 * because a line beside a mark is one line long. The rest of a message — what
 * is written under that first line, which is where the reason for a change
 * usually is — is asked for one commit at a time, the moment somebody stops on
 * one. Carried with the rest it would be a page of prose per dot, fetched on
 * every scan and almost never read.
 */

import { invoke } from "@tauri-apps/api/core";

export function commitMessage(repoId: string, oid: string): Promise<string> {
  return invoke("commit_message", { repoId, oid });
}
