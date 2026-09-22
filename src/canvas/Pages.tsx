import { useStore } from "@xyflow/react";
import { type ReactNode, useEffect, useState } from "react";
import { displayPath } from "../folder/format";
import { useAppSettings } from "../lib/appSettings";
import type { AppNode } from "../lib/graph";
import type { Session } from "../lib/session";
import { PageView } from "../page/PageView";
import { PagePortal, usePageWorkspace } from "../page/PageWorkspace";
import { filePageId, terminalPageId } from "../page/placement";
import { useGraphActions } from "./graphActions";
import { MIN_HEIGHT, MIN_WIDTH } from "./nodes/CliPageNode";

export function Pages({
  nodes,
  sessions,
  status,
}: {
  nodes: readonly AppNode[];
  sessions: readonly Session[];
  status?: ReactNode;
}) {
  const workspace = usePageWorkspace();
  const actions = useGraphActions();
  const { fileTitle } = useAppSettings();
  const zoom = useStore((state) => state.transform[2]);
  const [scale, setScale] = useState(zoom);
  useEffect(() => {
    const timer = setTimeout(() => setScale(Math.round(zoom * 100) / 100), 150);
    return () => clearTimeout(timer);
  }, [zoom]);
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
            place={placement === "canvas" && node.data.pinnedAt ? "pinned" : placement}
          >
            <PageView kind="file" data={node.data} actions={actions} placement={placement} />
          </PagePortal>
        );
      })}
      {sessions.map((session) => {
        const id = terminalPageId(session.id);
        const placement = workspace.placement(id);
        const node = nodes.find(
          (one) => one.type === "cli-page" && one.data.session.id === session.id,
        );
        const collapsed = node?.type === "cli-page" && node.data.collapsed;
        const shown = placement === "sidebar" ? workspace.showing === id : !collapsed;
        const name = fileTitle === "path" ? displayPath(session.cwd) : session.branch;
        return (
          <PagePortal
            key={id}
            id={id}
            name={name}
            place={placement}
            focus={shown ? ".xterm-helper-textarea" : undefined}
          >
            <PageView
              kind="terminal"
              status={status}
              session={session}
              placement={placement}
              scale={placement === "canvas" ? scale : 1}
              shown={shown}
              collapsed={collapsed}
              controls={{
                move: () => workspace.move(id, placement === "canvas" ? "sidebar" : "canvas"),
                hide: workspace.hide,
                collapse: () => actions.collapseCliPage(session.id),
                shrink: () => actions.fitCliPage(session.id, MIN_WIDTH, MIN_HEIGHT),
              }}
              onEnded={() => actions.endSession(session)}
            />
          </PagePortal>
        );
      })}
    </>
  );
}
