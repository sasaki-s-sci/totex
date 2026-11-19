import type { ReactNode } from "react";
import { baseName, displayPath } from "../folder/format";
import { groupBy } from "../lib/collections";
import { usePageWorkspace } from "./PageWorkspace";

export function TerminalList({ children }: { children?: ReactNode }) {
  const workspace = usePageWorkspace();
  if (!workspace) return null;
  const groups = groupBy(
    workspace.numbered.map((entry, index) => ({ ...entry, number: index + 1 })),
    (entry) => entry.folder ?? entry.name,
  );
  return (
    <div className="page__terminal-list">
      {[...groups].map(([folder, entries]) => (
        <div className="page__terminal-group" key={folder} title={displayPath(folder)}>
          <span className="page__terminal-name">{baseName(folder)}</span>
          <div className="page__terminal-numbers">
            {entries.map(({ id, number }) => (
              <span key={id} data-active={workspace.active === id}>
                {number}
              </span>
            ))}
          </div>
        </div>
      ))}
      {children}
    </div>
  );
}
