import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sourceBytes } from "./documentSource";

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfReading({ source, name }: { source: string; name: string }) {
  const { t } = useTranslation();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const [rendering, setRendering] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const assets = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, document.baseURI).href;
    const task = getDocument({
      data: sourceBytes(source),
      cMapUrl: `${assets}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assets}standard_fonts/`,
      wasmUrl: `${assets}wasm/`,
    });
    task.onPassword = () => {
      if (active) setFailed(true);
      void task.destroy();
    };
    void task.promise
      .then((document) => {
        if (active) setPdf(document);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [source]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = paper.current;
    if (!pdf || !container || width <= 0) return;
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${name} — ${page}`);
    container.replaceChildren(canvas);
    setRendering(true);
    setFailed(false);
    void pdf
      .getPage(page)
      .then(async (sheet) => {
        if (!active) return;
        const original = sheet.getViewport({ scale: 1 });
        const scale = (Math.max(1, width - 24) / original.width) * zoom;
        const view = sheet.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          4096 / Math.max(view.width, view.height),
        );
        canvas.width = Math.max(1, Math.floor(view.width * ratio));
        canvas.height = Math.max(1, Math.floor(view.height * ratio));
        canvas.style.width = `${view.width}px`;
        canvas.style.height = `${view.height}px`;
        render = sheet.render({ canvas, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0] });
        await render.promise;
        if (active) setRendering(false);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setRendering(false);
        }
      });
    return () => {
      active = false;
      render?.cancel();
      canvas.remove();
    };
  }, [pdf, page, zoom, width, name]);

  return (
    <div className="file-preview__document">
      <div className="file-preview__document-tools">
        <button
          type="button"
          aria-label={t("filePreview.previousPage")}
          disabled={!pdf || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          ‹
        </button>
        <span>
          {page} / {pdf?.numPages ?? "…"}
        </span>
        <button
          type="button"
          aria-label={t("filePreview.nextPage")}
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          ›
        </button>
        <button
          type="button"
          aria-label={t("filePreview.zoomOut")}
          disabled={zoom <= 0.25}
          onClick={() => setZoom(Math.max(0.25, zoom / 1.25))}
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label={t("filePreview.zoomIn")}
          disabled={zoom >= 4}
          onClick={() => setZoom(Math.min(4, zoom * 1.25))}
        >
          +
        </button>
        <button type="button" onClick={() => setZoom(1)}>
          {t("filePreview.pdfFitWidth")}
        </button>
      </div>
      {failed ? (
        <p className="file-preview__message is-error" role="alert">
          {t("filePreview.documentFailed")}
        </p>
      ) : (
        rendering && (
          <p className="file-preview__document-status" role="status">
            {t("filePreview.loading")}
          </p>
        )
      )}
      <div className="file-preview__pdf-scroll nopan" ref={viewport}>
        <div className="file-preview__pdf-paper" ref={paper} />
      </div>
    </div>
  );
}
