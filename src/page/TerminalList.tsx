import { baseName, displayPath } from "../folder/format";
import { usePageWorkspace } from "./PageWorkspace";

export function TerminalList() {
  const workspace = usePageWorkspace();
  if (!workspace) return null;
  const groups: { folder: string; start: number; ids: string[] }[] = [];
  workspace.numbered.forEach((entry, index) => {
    const folder = entry.folder ?? entry.name;
    const last = groups.at(-1);
    if (last?.folder === folder) last.ids.push(entry.id);
    else groups.push({ folder, start: index + 1, ids: [entry.id] });
  });
  return (
    <div className="page__terminal-list" aria-hidden="true">
      {groups.map(({ folder, start, ids }) => (
        <div className="page__terminal-group" key={ids[0]} title={displayPath(folder)}>
          <span className="page__terminal-name">{baseName(folder)}</span>
          <div className="page__terminal-numbers">
            {ids.map((id, index) => (
              <span key={id} data-active={workspace.active === id}>
                {start + index}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
