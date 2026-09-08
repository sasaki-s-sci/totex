import fontUrl from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url";
import { DxfViewer } from "dxf-viewer";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sourceBytes } from "./documentSource";

export function DxfReading({ source, name }: { source: string; name: string }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<DxfViewer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "empty">("loading");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let active = true;
    let drawing: DxfViewer | null = null;
    let worker: Worker | null = null;
    const url = URL.createObjectURL(new Blob([sourceBytes(source)]));
    try {
      drawing = new DxfViewer(element, { autoResize: true });
      viewer.current = drawing;
      drawing.Subscribe("message", (event) => {
        if (active && String(event.detail?.message).includes("missing fonts")) setMissing(true);
      });
      void drawing
        .Load({
          url,
          fonts: [fontUrl],
          workerFactory: () => {
            worker = new Worker(new URL("./dxf.worker.ts", import.meta.url), { type: "module" });
            return worker;
          },
        })
        .then(() => {
          if (active) setState(drawing?.GetBounds() ? "ready" : "empty");
        })
        .catch(() => {
          if (active) setState("failed");
        });
    } catch {
      setState("failed");
    }
    return () => {
      active = false;
      worker?.terminate();
      drawing?.Destroy();
      viewer.current = null;
      element.replaceChildren();
      URL.revokeObjectURL(url);
    };
  }, [source]);

  function fit() {
    const drawing = viewer.current;
    const bounds = drawing?.GetBounds();
    const origin = drawing?.GetOrigin();
    if (!drawing || !bounds || !origin) return;
    drawing.FitView(
      bounds.minX - origin.x,
      bounds.maxX - origin.x,
      bounds.minY - origin.y,
      bounds.maxY - origin.y,
      0.1,
    );
    drawing.Render();
  }

  return (
    <div className="file-preview__document nopan">
      <div className="file-preview__document-tools">
        <span>DXF</span>
        <button type="button" disabled={state !== "ready"} onClick={fit}>
          {t("filePreview.fitView")}
        </button>
      </div>
      {state !== "ready" && (
        <p className="file-preview__document-status" role={state === "failed" ? "alert" : "status"}>
          {t(
            state === "failed"
              ? "filePreview.documentFailed"
              : state === "empty"
                ? "filePreview.emptyDrawing"
                : "filePreview.loading",
          )}
        </p>
      )}
      {missing && <p className="file-preview__document-status">{t("filePreview.missingGlyphs")}</p>}
      <div className="file-preview__dxf" ref={host} role="img" aria-label={name} />
    </div>
  );
}
