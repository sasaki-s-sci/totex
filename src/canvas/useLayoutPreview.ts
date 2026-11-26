import { invoke } from "@tauri-apps/api/core";
import { type RefObject, useEffect } from "react";
import { frontInactive } from "../shell/bridge";

/** Capture the existing panes, including cross-origin frames, without mounting another copy. */
export function useLayoutPreview(
  map: RefObject<HTMLFieldSetElement | null>,
  id: string | undefined,
  shown: boolean,
) {
  useEffect(() => {
    if (!id || !shown) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const measure = () => {
      const canvas = document.querySelector<HTMLElement>(".session-canvas:not([hidden])");
      if (canvas?.dataset.sessionCanvas !== id) return [];
      return [...canvas.querySelectorAll<HTMLElement>(":scope > [data-canvas-pane]")].map(
        (element) => ({ id: element.dataset.canvasPane, rect: element.getBoundingClientRect() }),
      );
    };
    const refresh = async () => {
      try {
        if (document.hidden || frontInactive()) return;
        const panes = measure();
        if (!panes.length) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        const image = new Image();
        image.src = `data:image/png;base64,${await invoke<string>("canvas_snapshot")}`;
        await image.decode();
        if (
          !alive ||
          width !== window.innerWidth ||
          height !== window.innerHeight ||
          JSON.stringify(panes) !== JSON.stringify(measure())
        )
          return;
        const scaleX = image.naturalWidth / width;
        const scaleY = image.naturalHeight / height;
        for (const target of map.current?.querySelectorAll<HTMLCanvasElement>(
          ".layout-pane canvas",
        ) ?? []) {
          const pane = panes.find((pane) => pane.id === target.parentElement?.dataset.layoutPane);
          const context = target.getContext("2d");
          if (!pane || !context || !pane.rect.width || !pane.rect.height) continue;
          const bounds = target.getBoundingClientRect();
          target.width = Math.max(1, Math.round(bounds.width * devicePixelRatio));
          target.height = Math.max(1, Math.round(bounds.height * devicePixelRatio));
          context.drawImage(
            image,
            pane.rect.x * scaleX,
            pane.rect.y * scaleY,
            pane.rect.width * scaleX,
            pane.rect.height * scaleY,
            0,
            0,
            target.width,
            target.height,
          );
          target.dataset.ready = "true";
        }
      } catch {
        // Keep labels available when a native capture is temporarily unavailable.
      } finally {
        if (alive) timer = setTimeout(refresh, 1000);
      }
    };
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, shown, map]);
}
