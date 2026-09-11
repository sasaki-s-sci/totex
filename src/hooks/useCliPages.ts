/**
 * The terminals stood on the canvas as pages.
 *
 * Which sessions are pages is the window's to say — `paged` in `useSessions`,
 * because the panel on the other side of the window has to stop drawing a
 * terminal the moment the canvas starts. What is the canvas's own is where each
 * page stands and how big it is, which React Flow owns once the page is placed
 * and which is kept across a change of front the way a file card's is.
 */

import { useCallback, useEffect } from "react";
import type { CliPageFlowNode, FilePreviewBox } from "../lib/graph";
import type { Session } from "../lib/session";
import { frontValue } from "../shell/state";
import { canvasMiddle, PAGE_HANDLE, PAGE_Z, pageCorner } from "./pagePlacing";
import type { PageCanvas } from "./useFilePreviews";

/** The size a terminal page opens at, in canvas units: eighty columns of the
 *  panel's face and a couple of dozen rows, at the canvas's own scale. */
export const CLI_PAGE_SIZE = { width: 640, height: 400 } as const;

export function cliPageId(sessionId: string): string {
  return `cli-page:${sessionId}`;
}

/** The size a page is standing at: its own once an edge has been dragged, and
 *  the size it was opened at until then. Put away, it keeps the one it had. */
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
      // A page whose session has gone back to the panel, or ended, comes down;
      // one still standing is told whether it is the one in hand.
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
        // A page this front was handed from the last one stands where it stood.
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
            // Put away, the page is given no height at all and the canvas
            // measures what its header comes to.
            height: collapsed ? undefined : size.height,
          };
        }),
      );
    },
    [setNodes],
  );

  return { collapseCliPage };
}
