import { displayPath } from "../folder/format";
import { useAppSettings } from "../lib/appSettings";
import type { AppNode } from "../lib/graph";
import type { Session } from "../lib/session";
import { PageView } from "../page/PageView";
import { PagePortal, usePageWorkspace } from "../page/PageWorkspace";
import { filePageId, terminalPageId } from "../page/placement";
import { useGraphActions } from "./graphActions";

export function Pages({
  nodes,
  sessions,
}: {
  nodes: readonly AppNode[];
  sessions: readonly Session[];
}) {
  const workspace = usePageWorkspace();
  const actions = useGraphActions();
  const { fileTitle } = useAppSettings();
  if (!workspace) return null;
  return (
    <>
      {nodes.flatMap((node) => {
        if (node.type !== "file-preview") return [];
        const id = filePageId(node.data.requestId);
        const placement = workspace.placement(id);
        const name = fileTitle === "path" ? displayPath(node.data.path) : node.data.name;
        return (
          <PagePortal
            key={id}
            id={id}
            name={name}
            place={placement === "canvas" ? "cards" : placement}
          >
            <PageView
              kind="file"
              data={node.data}
              actions={actions}
              placement={placement}
              scale={1}
            />
          </PagePortal>
        );
      })}
      {sessions.map((session, index) => {
        const id = terminalPageId(session.id);
        const viewing =
          workspace.sidebarOpen && (workspace.showing === id || workspace.lower === id);
        const name = fileTitle === "path" ? displayPath(session.cwd) : session.branch;
        return (
          <span key={id} style={{ display: "contents" }}>
            <PagePortal
              id={id}
              name={name}
              place="cards"
              focus={
                workspace.active === id && workspace.activePlace === "cards"
                  ? ".page-agent button, .xterm-helper-textarea"
                  : undefined
              }
            >
              <PageView
                kind="terminal"
                session={session}
                number={index + 1}
                placement="canvas"
                scale={1}
                shown
                compact={!workspace.expanded.includes(id)}
                resize={!viewing}
                controls={{
                  viewer: true,
                  move: () => workspace.move(id, "sidebar"),
                  close: () => actions.endSession(session),
                }}
                onEnded={() => actions.endSession(session)}
              />
            </PagePortal>
            {workspace.placement(id) === "sidebar" && (
              <PagePortal
                id={id}
                name={name}
                place="sidebar"
                registerEntry={false}
                focus={
                  viewing && workspace.active === id && workspace.activePlace === "sidebar"
                    ? ".xterm-helper-textarea"
                    : undefined
                }
              >
                <PageView
                  kind="terminal"
                  session={session}
                  number={index + 1}
                  placement="sidebar"
                  scale={1}
                  viewer
                  shown={viewing}
                  compact={false}
                  resize={viewing}
                  controls={{
                    viewer: true,
                    move: () => workspace.move(id, "canvas"),
                    hide: workspace.hide,
                  }}
                  onEnded={() => undefined}
                />
              </PagePortal>
            )}
          </span>
        );
      })}
    </>
  );
}
