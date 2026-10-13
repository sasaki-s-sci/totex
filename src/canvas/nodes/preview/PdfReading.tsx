import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sourceBytes } from "./documentSource";
import "./pdfReading.css";

GlobalWorkerOptions.workerSrc = workerUrl;

// Backing-store bounds for one page: wide enough to stay sharp at a high canvas zoom, small
// enough that a tall page at that zoom does not exhaust the webview's canvas memory.
const MOST_SIDE = 8192;
const MOST_AREA = 2 ** 24;

/**
 * `zoom` is the canvas's, and only redraws the page when it settles: the scale drawn at is
 * measured from the screen, which also covers a pinned card and a torn-off window.
 */
export function PdfReading({
  source,
  name,
  zoom: canvasZoom = 1,
}: {
  source: string;
  name: string;
  zoom?: number;
}) {
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
      // The text layer measures on a hidden canvas it puts in the body, left there between pages.
      TextLayer.cleanup();
    };
  }, [source]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the canvas's zoom is a trigger; the scale drawn at is measured
  useEffect(() => {
    const container = paper.current;
    if (!pdf || !container || width <= 0) return;
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    let text: TextLayer | undefined;
    // Drawn off the page and swapped in once done: a blank canvas in its place would shrink the
    // scroller for a frame, and the page shown until then would blink out.
    const sheet = document.createElement("div");
    sheet.className = "pdf-reading__sheet";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${name} — ${page}`);
    setRendering(true);
    setFailed(false);
    void pdf
      .getPage(page)
      .then(async (leaf) => {
        if (!active) return;
        const original = leaf.getViewport({ scale: 1 });
        const scale = (Math.max(1, width - 24) / original.width) * zoom;
        const view = leaf.getViewport({ scale });
        const element = viewport.current;
        const onScreen =
          element && element.offsetWidth > 0
            ? element.getBoundingClientRect().width / element.offsetWidth
            : 1;
        const ratio = Math.min(
          (window.devicePixelRatio || 1) * Math.max(1, onScreen),
          MOST_SIDE / Math.max(view.width, view.height),
          Math.sqrt(MOST_AREA / (view.width * view.height)),
        );
        canvas.width = Math.max(1, Math.floor(view.width * ratio));
        canvas.height = Math.max(1, Math.floor(view.height * ratio));
        canvas.style.width = `${view.width}px`;
        canvas.style.height = `${view.height}px`;
        sheet.style.width = `${view.width}px`;
        sheet.style.height = `${view.height}px`;
        render = leaf.render({ canvas, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0] });
        // Transparent spans laid over the drawing, so the page's words can be selected and copied.
        const words = document.createElement("div");
        words.className = "textLayer";
        words.style.setProperty("--total-scale-factor", `${view.scale * view.userUnit}`);
        sheet.append(canvas, words);
        text = new TextLayer({
          textContentSource: leaf.streamTextContent(),
          container: words,
          viewport: view,
        });
        await Promise.all([render.promise, text.render()]);
        TextLayer.cleanup();
        if (!active) return;
        container.replaceChildren(sheet);
        setRendering(false);
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
      text?.cancel();
    };
  }, [pdf, page, zoom, width, name, canvasZoom]);

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
        {/* In the bar, not over the scroller: a line coming and going would move the page. */}
        {!failed && rendering && (
          <span className="file-preview__pdf-status" role="status">
            {t("filePreview.loading")}
          </span>
        )}
      </div>
      {failed && (
        <p className="file-preview__message is-error" role="alert">
          {t("filePreview.documentFailed")}
        </p>
      )}
      <div className="file-preview__pdf-scroll nopan" ref={viewport}>
        <div className="file-preview__pdf-paper" ref={paper} />
      </div>
    </div>
  );
}
