import { displayPath } from "../folder/format";
import type { Session } from "../lib/session";
import { usePageWorkspace } from "./PageWorkspace";
import { terminalPageId } from "./placement";

export function TerminalList() {
  const workspace = usePageWorkspace();
  if (!workspace) return null;
  const groups: { session: Session; start: number; sessions: Session[] }[] = [];
  // Consecutive groups keep the numbers in the same order as the terminal shortcuts.
  workspace.terminals.forEach((session, index) => {
    const last = groups.at(-1);
    if (last?.session.cwd === session.cwd) last.sessions.push(session);
    else groups.push({ session, start: index + 1, sessions: [session] });
  });
  return (
    <div className="page__terminal-list" aria-hidden="true">
      {groups.map(({ session, start, sessions }) => (
        <div className="page__terminal-group" key={session.id} title={displayPath(session.cwd)}>
          <span className="page__terminal-name">{session.branch}</span>
          <div className="page__terminal-numbers">
            {sessions.map((terminal, index) => (
              <span
                key={terminal.id}
                data-active={workspace.showing === terminalPageId(terminal.id)}
              >
                {start + index}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
