export type PagePlacement = "canvas" | "sidebar";

export function filePageId(requestId: number): string {
  return `file:${requestId}`;
}

export function terminalPageId(sessionId: string): string {
  return `terminal:${sessionId}`;
}

export function placementOf(
  id: string,
  dockedFiles: readonly string[],
  pagedSessions: readonly string[],
): PagePlacement {
  return id.startsWith("terminal:")
    ? pagedSessions.some((session) => terminalPageId(session) === id)
      ? "canvas"
      : "sidebar"
    : dockedFiles.includes(id)
      ? "sidebar"
      : "canvas";
}
