/**
 * What a card can be asked to do once it is standing: written back to its file,
 * put away, fitted to its reading, and taken off the canvas.
 */

import { useCallback, useMemo } from "react";
import { writeFile } from "../folder/api";
import { refreshChanges } from "../folder/changes";
import { previewable } from "../lib/filePreview";
import type { FilePreviewFlowNode } from "../lib/graph";
import { fileSize, readableSize } from "./filePreviewBox";
import type { PageCanvas } from "./useFilePreviews";
import { heldInPane, usePinDrag } from "./usePinDrag";

export function useFilePreviewCard(
  { host, instance, standing, nodes, setNodes }: PageCanvas,
  previewFile: (path: string, beside: number) => void,
) {
  /**
   * Writes one card's reading back to its file.
   *
   * The card holds what is being typed — a keystroke is not something the graph
   * is rebuilt for — and hands it over here when it is to be kept. What comes
   * back is how long the file now is, which is what the next write is checked
   * against, so the card is only told the two things the disk has just settled.
   *
   * A card whose file has not been read whole is never written: the backend
   * refuses it, and so does the card, because what is on screen is only the
   * head of it and writing that back would drop the rest.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const saveFilePreview = useCallback(
    async (requestId: number, text: string) => {
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      if (!node || node.data.size === null || node.data.truncated) return false;
      try {
        const size = await writeFile(node.data.path, text, node.data.size);
        // Every card on that file, not only the one that was typed into: a
        // preview stands beside the card it is of, and what it is a preview of
        // is what has just gone to disk.
        setNodes((current) =>
          current.map((one) =>
            one.type === "file-preview" && one.data.path === node.data.path
              ? { ...one, data: { ...one.data, text, size } }
              : one,
          ),
        );
        // What git says about the folder this is in has just moved, and the
        // clock that would notice is a slow one. The column redraws off the
        // same reading, and so does the card's own gutter.
        refreshChanges();
        return true;
      } catch {
        return false;
      }
    },
    [setNodes],
  );

  const collapseFilePreview = useCallback(
    (requestId: number) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          const collapsed = !node.data.collapsed;
          const size = fileSize(node);
          return {
            ...node,
            data: { ...node.data, collapsed, box: size },
            width: size.width,
            // Put away, the card is given no height at all and the canvas
            // measures what its header comes to — so a header that changes
            // shape has nothing here to be kept in step with.
            height: collapsed ? undefined : size.height,
          };
        }),
      );
    },
    [setNodes],
  );

  /**
   * Shows the patch in place of the reading, or puts the reading back.
   *
   * The card is the same card either way — the same file, the same box, the
   * same place on the canvas — so this is what it is showing of it and not
   * another card. A preview is the other kind: it stands beside its file
   * rather than in place of it, which is what `previewFilePreview` opens.
   */
  const diffFilePreview = useCallback(
    (requestId: number) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          // A card that is already a page of its file has no reading to turn
          // over: the file it is drawn from is the card beside it.
          if (node.data.view === "markdown") return node;
          const view = node.data.view === "diff" ? "text" : "diff";
          return { ...node, data: { ...node.data, view } };
        }),
      );
    },
    [setNodes],
  );

  /**
   * Opens a rendering of one card's file beside it.
   *
   * Refused for a card that is already a page — a preview of a preview is the
   * card it is standing on — and for a file there is no drawing of, which is
   * everything but markdown for now.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const previewFilePreview = useCallback(
    (requestId: number) => {
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      if (!node || node.data.view === "markdown" || !previewable(node.data.path)) return;
      previewFile(node.data.path, requestId);
    },
    [previewFile],
  );

  /**
   * Puts one card at a width that was measured rather than dragged to.
   *
   * What it needs is the card's own answer — it is the only thing that can see
   * its reading — and how much of that it gets is the canvas's: a minified file
   * is one line a hundred thousand characters long, and a card as wide as that
   * line is a card whose header cannot be reached without the whole graph being
   * zoomed out past reading. So the width is held to what is on screen, which
   * is the widest a card can be and still be a card.
   *
   * Only the width. A reading is as long as the file, and a card as tall as one
   * would be a card with no canvas left around it.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const fitFilePreview = useCallback(
    (requestId: number, wanted: number) => {
      const room = host.current?.clientWidth ?? 0;
      const zoom = instance.current?.getViewport().zoom ?? 1;
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          // A pinned card is drawn over the canvas rather than on it, so the
          // room there is for it is the pane itself — the zoom is something it
          // stepped out of when it was pinned.
          const most = node.data.pinnedAt ? room : room / zoom;
          const width = room > 0 ? Math.min(wanted, most) : wanted;
          return { ...node, width, data: { ...node.data, box: { ...fileSize(node), width } } };
        }),
      );
    },
    [setNodes],
  );

  /**
   * Takes a card off the canvas and holds it over the window, or puts it back.
   *
   * Pinned, the node is hidden and the card is drawn on the layer over the
   * graph instead, so nothing the canvas does — a pan, a zoom, a repository
   * opening out and pushing every band along — reaches it. Where it floats is
   * measured in the pane's own pixels, which is the coordinate system it has
   * just stepped into.
   *
   * Unpinned, it goes back under itself rather than back where it came from:
   * the canvas is asked what is now at the point the card has been floating
   * over, and the node is put there. A card pinned, the graph panned across a
   * repository, and the card let go stays on screen where the reader left it.
   *
   * Its box crosses with it. A card on the canvas is drawn at the zoom and one
   * over the window is drawn at none, so the same numbers on either side of the
   * step are two different cards on screen — a graph at half scale pinned a card
   * to twice the size it had just been read at. The box is multiplied by the
   * zoom on the way out and divided by it on the way back, which leaves the card
   * standing at the size it was: what changes is only what it is nailed to.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const pinFilePreview = useCallback(
    (requestId: number) => {
      const flow = instance.current;
      const pane = host.current?.getBoundingClientRect();
      if (!flow || !pane) return;
      const { zoom } = flow.getViewport();
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          const at = node.data.pinnedAt;
          const box = fileSize(node);
          // A card put away carries no height of its own — the canvas measures
          // what its header comes to — and one handed back here would give it a
          // body again. The height it had is kept in the box either way.
          const measured = node.height === undefined;
          if (at) {
            const under = readableSize({ width: box.width / zoom, height: box.height / zoom });
            return {
              ...node,
              hidden: false,
              position: flow.screenToFlowPosition({ x: pane.left + at.x, y: pane.top + at.y }),
              width: under.width,
              height: measured ? undefined : under.height,
              data: { ...node.data, box: under, pinnedAt: null },
            };
          }
          const corner = flow.flowToScreenPosition(node.position);
          const over = readableSize({ width: box.width * zoom, height: box.height * zoom });
          return {
            ...node,
            hidden: true,
            width: over.width,
            height: measured ? undefined : over.height,
            data: {
              ...node.data,
              box: over,
              // Held inside the pane by the same rule a drag is, so that a card
              // pinned while it is half off the canvas is not pinned half out
              // of the window.
              pinnedAt: heldInPane(
                { x: corner.x - pane.left, y: corner.y - pane.top },
                pane,
                over.width,
              ),
            },
          };
        }),
      );
    },
    [setNodes],
  );

  /**
   * Where a pinned card has been dragged to, once it is let go.
   *
   * Only then: the card writes where it is standing to its own element for the
   * length of the drag, so the graph is left alone until it comes to rest.
   */
  const movePinned = useCallback(
    (requestId: number, at: { x: number; y: number }) => {
      setNodes((current) =>
        current.map((node) =>
          node.type === "file-preview" && node.data.requestId === requestId
            ? { ...node, data: { ...node.data, pinnedAt: at } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const pinDrag = usePinDrag(host, movePinned);

  /** The cards that have left the canvas, in the order they were opened. */
  const pinnedFiles = useMemo(
    () =>
      nodes.filter(
        (node): node is FilePreviewFlowNode =>
          node.type === "file-preview" && node.data.pinnedAt !== null,
      ),
    [nodes],
  );
  return {
    saveFilePreview,
    collapseFilePreview,
    diffFilePreview,
    previewFilePreview,
    fitFilePreview,
    pinFilePreview,
    pinDrag,
    pinnedFiles,
  };
}
