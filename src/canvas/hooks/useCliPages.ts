import { useCallback, useEffect } from "react";
import type { CliPageFlowNode, FilePreviewBox } from "../../lib/graph";
import type { Session } from "../../lib/session";
import { frontValue } from "../../shell/state";
import { canvasMiddle, PAGE_HANDLE, PAGE_Z, pageCorner } from "./pagePlacing";
import type { PageCanvas } from "./useFilePreviews";

export const CLI_PAGE_SIZE = { width: 640, height: 400 } as const;

export function cliPageId(sessionId: string): string {
  return `cli-page:${sessionId}`;
}

export function cliPageSize(node: CliPageFlowNode): FilePreviewBox {
  const box = node.data.box;
  return { width: node.width ?? box.width, height: node.height ?? box.height };
}

export function useCliPages(
  sessions: readonly Session[],
  paged: readonly string[],
  showing: string | null,
  { host, instance, setNodes, flowReady }: PageCanvas,
) {
  useEffect(() => {
    if (!flowReady || !instance.current) return;
    const flow = instance.current;
    const wanted = new Map(
      sessions.filter((session) => paged.includes(session.id)).map((s) => [s.id, s] as const),
    );
    const bounds = host.current?.getBoundingClientRect();
    setNodes((current) => {
      let changed = false;

      const kept: typeof current = [];
      const standing = new Set<string>();
      for (const node of current) {
        if (node.type !== "cli-page") {
          kept.push(node);
          continue;
        }
        const id = node.data.session.id;
        if (!wanted.has(id)) {
          changed = true;
          continue;
        }
        standing.add(id);
        const inHand = id === showing;
        if (node.data.showing === inHand) kept.push(node);
        else {
          changed = true;
          kept.push({ ...node, data: { ...node.data, showing: inHand } });
        }
      }
      const fresh = [...wanted.values()].filter((session) => !standing.has(session.id));
      if (fresh.length === 0) return changed ? kept : current;
      const additions = fresh.map((session, at) => {
        const remembered = frontValue<CliPageFlowNode[]>("canvas.clis")?.find(
          (node) => node.data.session.id === session.id,
        );
        if (remembered) return { ...remembered, data: { ...remembered.data, session } };
        const box = CLI_PAGE_SIZE;
        const node: CliPageFlowNode = {
          id: cliPageId(session.id),
          type: "cli-page",
          position: pageCorner(flow, canvasMiddle(bounds, box, at * 16), box),
          draggable: true,
          dragHandle: PAGE_HANDLE,
          zIndex: PAGE_Z,
          ...box,
          data: { session, showing: session.id === showing, collapsed: false, box },
        };
        return node;
      });
      return [...kept, ...additions];
    });
  }, [sessions, paged, showing, flowReady, host, instance, setNodes]);

  const collapseCliPage = useCallback(
    (sessionId: string) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "cli-page" || node.data.session.id !== sessionId) return node;
          const collapsed = !node.data.collapsed;
          const size = cliPageSize(node);
          return {
            ...node,
            data: { ...node.data, collapsed, box: size },
            width: size.width,

            // Collapsed, the page has no height; the canvas measures the header.
            height: collapsed ? undefined : size.height,
          };
        }),
      );
    },
    [setNodes],
  );

  const fitCliPage = useCallback(
    (sessionId: string, width: number, height: number) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "cli-page" || node.data.session.id !== sessionId) return node;
          return {
            ...node,
            width,

            height: node.data.collapsed ? undefined : height,
            data: { ...node.data, box: { width, height } },
          };
        }),
      );
    },
    [setNodes],
  );

  return { collapseCliPage, fitCliPage };
}
