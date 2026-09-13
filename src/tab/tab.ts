import type { FilePreviewRequest } from "../lib/filePreview";
import type { Session } from "../lib/session";

/** A terminal tab is keyed by its session id, so `showing` names either kind. */
export type TerminalTab = { kind: "terminal"; id: string; session: Session };
export type FileTab = { kind: "file"; id: string; file: FilePreviewRequest };
export type Tab = TerminalTab | FileTab;

export function terminalTab(session: Session): TerminalTab {
  return { kind: "terminal", id: session.id, session };
}

export function fileTab(file: FilePreviewRequest): FileTab {
  return { kind: "file", id: `file:${file.id}`, file };
}

export function terminalTabs(sessions: readonly Session[]): TerminalTab[] {
  return sessions.map(terminalTab);
}
