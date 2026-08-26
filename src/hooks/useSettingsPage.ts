/** Places the settings page in the canvas, beside the file pages. */

import { useEffect, useRef } from "react";
import type { SettingsFlowNode } from "../lib/graph";
import type { PageCanvas } from "./useFilePreviews";

const SETTINGS_PAGE_SIZE = { width: 760, height: 390 } as const;
const SETTINGS_PAGE_ID = "settings";
const SETTINGS_PAGE_Z = 1_100;

/**
 * Keeps the window's one settings page on the canvas while it is open.
 *
 * Like a file page, it opens in the middle of the viewport and belongs to the
 * canvas from then on. Its position and resized box are React Flow's to keep;
 * only closing it takes it out.
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
    const centre = flow.screenToFlowPosition({
      x: (bounds?.left ?? 0) + (bounds?.width ?? SETTINGS_PAGE_SIZE.width) / 2,
      y: (bounds?.top ?? 0) + (bounds?.height ?? SETTINGS_PAGE_SIZE.height) / 2,
    });

    const page: SettingsFlowNode = {
      id: SETTINGS_PAGE_ID,
      type: "settings",
      position: {
        x: centre.x - SETTINGS_PAGE_SIZE.width / 2,
        y: centre.y - 17,
      },
      draggable: true,
      dragHandle: ".file-preview__header",
      zIndex: SETTINGS_PAGE_Z,
      width: SETTINGS_PAGE_SIZE.width,
      height: SETTINGS_PAGE_SIZE.height,
      data: { page: "settings" },
    };

    setNodes((current) => [...current.filter((node) => node.type !== "settings"), page]);
  }, [open, flowReady, host, instance, setNodes]);
}
