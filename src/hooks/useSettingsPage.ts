/** Places the settings page in the canvas, beside the file pages. */

import { useEffect, useRef } from "react";
import type { SettingsFlowNode } from "../lib/graph";
import { canvasMiddle, PAGE_HANDLE, PAGE_Z, pageCorner } from "./pagePlacing";
import type { PageCanvas } from "./useFilePreviews";

const SETTINGS_PAGE_SIZE = { width: 760, height: 390 } as const;
const SETTINGS_PAGE_ID = "settings";

/**
 * Keeps the window's one settings page on the canvas while it is open.
 *
 * Like a file page, it opens in the middle of the viewport and belongs to the
 * canvas from then on — same panel, same layer, same handle, and `pagePlacing`
 * is where all three are said. Its position and resized box are React Flow's to
 * keep; only closing it takes it out.
 */
export function useSettingsPage(
  open: boolean,
  { host, instance, setNodes, flowReady }: PageCanvas,
) {
  const placed = useRef(false);

  useEffect(() => {
    if (!open) {
      placed.current = false;
      setNodes((current) => {
        const kept = current.filter((node) => node.type !== "settings");
        return kept.length === current.length ? current : kept;
      });
      return;
    }
    if (!flowReady || !instance.current || placed.current) return;

    placed.current = true;
    const flow = instance.current;
    const bounds = host.current?.getBoundingClientRect();

    const page: SettingsFlowNode = {
      id: SETTINGS_PAGE_ID,
      type: "settings",
      position: pageCorner(flow, canvasMiddle(bounds, SETTINGS_PAGE_SIZE), SETTINGS_PAGE_SIZE),
      draggable: true,
      dragHandle: PAGE_HANDLE,
      zIndex: PAGE_Z,
      width: SETTINGS_PAGE_SIZE.width,
      height: SETTINGS_PAGE_SIZE.height,
      data: { page: "settings" },
    };

    setNodes((current) => [...current.filter((node) => node.type !== "settings"), page]);
  }, [open, flowReady, host, instance, setNodes]);
}
