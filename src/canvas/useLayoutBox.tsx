import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import {
  type CSSProperties,
  type DragEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { baseName } from "../folder/format";
import { MarkButton, SIZE } from "../marks";
import { canvasGeometry } from "./geometry";
import {
  type CanvasSplit,
  dockSplit,
  dropEdge,
  type Edge,
  fitSplit,
  paneGrid,
  type Rectangle,
  splitRects,
  tileSplit,
} from "./layout";
import { adjacentPane, type CanvasPane } from "./model";
import "./layoutBox.css";

export type LayoutBoxOptions = {
  id: string;
  panes: CanvasPane[];
  tree?: CanvasSplit;
  arrange: (tree: CanvasSplit) => void;
  change: (update: (panes: CanvasPane[]) => CanvasPane[]) => Promise<void>;
};

const DRAG_TYPE = "application/x-totex-canvas-pane";
type Placement = { edge?: Edge; target?: string };

/** Read the rendered tracks so resized panes and the miniature always agree. */
function useLayoutRects(layout: LayoutBoxOptions | null, shown: boolean) {
  const [geometry, setGeometry] = useState<{ aspect: number; panes: Record<string, Rectangle> }>({
    aspect: 1,
    panes: {},
  });
  const id = layout?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: equal-size reorders move panes without firing ResizeObserver
  useLayoutEffect(() => {
    if (!shown) return;
    const main = document.querySelector("main");
    if (!main) return;
    let frame = 0;
    let observed = new Set<Element>();
    const measure = () => {
      frame = 0;
      const canvas = main.querySelector<HTMLElement>(".session-canvas:not([hidden])");
      const bounds = (canvas ?? main).getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const value = canvasGeometry(canvas && canvas.dataset.sessionCanvas === id ? canvas : main);
      const targets = new Set<Element>([main]);
      for (const pane of value.elements) targets.add(pane);
      for (const element of observed) if (!targets.has(element)) resize.unobserve(element);
      for (const element of targets) if (!observed.has(element)) resize.observe(element);
      observed = targets;
      const next = { aspect: value.aspect, panes: value.panes };
      setGeometry((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    const changes = new MutationObserver(schedule);
    changes.observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [id, shown, layout?.panes, layout?.tree]);
  return geometry;
}

export function useLayoutBox(
  layout: LayoutBoxOptions | null,
  shown: boolean,
  removeSidebarPane?: () => void,
) {
  const { t } = useTranslation();
  const geometry = useLayoutRects(layout, shown);
  const [selected, select] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [placement, place] = useState<Placement | null>(null);
  const [pending, setPending] = useState(false);
  const map = useRef<HTMLFieldSetElement>(null);
  const dragged = useRef<{ session: string; pane: string } | null>(null);
  const id = layout?.id;
  const sidebarDragging = Boolean(removeSidebarPane);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection and gestures belong to one canvas or sidebar drag
  useEffect(() => {
    select(null);
    setOver(null);
    place(null);
    dragged.current = null;
  }, [id, sidebarDragging]);
  const finish = () => {
    dragged.current = null;
    setOver(null);
    place(null);
  };
  const moving = (event: DragEvent) =>
    dragged.current?.session === id && event.dataTransfer.types.includes(DRAG_TYPE);
  const targetAt = (event: DragEvent): Placement | null => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const canvas = map.current?.getBoundingClientRect();
    if (!canvas) return null;
    const edge =
      dropEdge(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        bounds.width,
        bounds.height,
        4,
      ) ??
      dropEdge(
        event.clientX - canvas.left,
        event.clientY - canvas.top,
        canvas.width,
        canvas.height,
        4,
      );
    if (edge) return { edge };
    const pane = (event.target as Element).closest<HTMLElement>("[data-layout-pane]");
    const target = pane?.dataset.layoutPane;
    if (!pane || !target || target === dragged.current?.pane) return null;
    const rect = pane.getBoundingClientRect();
    return {
      target,
      edge:
        dropEdge(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height) ??
        undefined,
    };
  };
  const projected = (source: string, edge: Edge, target?: string) => {
    if (!layout) return null;
    const tree =
      layout.tree ??
      tileSplit(
        layout.panes.map((pane) => pane.id),
        geometry.aspect,
      );
    return tree && dockSplit(fitSplit(tree, geometry.panes), source, edge, target);
  };
  const dock = (source: string, edge: Edge, target?: string) => {
    const tree = projected(source, edge, target);
    if (tree) layout?.arrange(tree);
    finish();
  };
  const previewTree =
    placement?.edge && dragged.current
      ? projected(dragged.current.pane, placement.edge, placement.target)
      : null;
  const preview =
    previewTree && dragged.current ? splitRects(previewTree)[dragged.current.pane] : null;
  const change = (update: (panes: CanvasPane[]) => CanvasPane[]) => {
    if (!layout || pending) return;
    const focused = document.activeElement?.closest(".layout-box, .layout-trash");
    const index = layout.panes.findIndex((pane) => pane.id === selected);
    setPending(true);
    void layout
      .change(update)
      .catch(() => undefined)
      .finally(() => {
        setPending(false);
        if (focused)
          requestAnimationFrame(() => {
            if (map.current?.dataset.layoutCanvas !== layout.id) return;
            const buttons = [...map.current.querySelectorAll<HTMLButtonElement>("button")];
            (
              buttons.find((button) => button.dataset.layoutPane === selected) ??
              buttons[Math.min(Math.max(index, 0), buttons.length - 1)] ??
              map.current
            ).focus();
          });
      });
  };
  const remove = (paneId: string) => {
    change((panes) => panes.filter((pane) => pane.id !== paneId));
    finish();
  };
  const swap = (from: string, to: string) => {
    if (from === to) return;
    change((panes) => {
      const first = panes.find((pane) => pane.id === from);
      const second = panes.find((pane) => pane.id === to);
      if (!first || !second) return panes;
      return panes.map((pane) => (pane === first ? second : pane === second ? first : pane));
    });
  };
  const selectedPane = layout?.panes.find((pane) => pane.id === selected);
  const name = (pane: CanvasPane) =>
    pane.title ||
    (pane.kind === "file"
      ? baseName(pane.path)
      : pane.kind === "iframe"
        ? pane.url
        : "src" in pane
          ? baseName(pane.src)
          : t(`canvas.${pane.kind}`, { defaultValue: pane.kind }));

  return {
    trash: (
      <fieldset
        aria-label={t("canvas.layoutRemove")}
        className="layout-trash"
        data-layout-trash
        data-over={over === "trash" || undefined}
        onDragOver={(event) => {
          if ((!moving(event) && !removeSidebarPane) || pending) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          place(null);
          setOver("trash");
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(event) => {
          if ((!moving(event) && !removeSidebarPane) || pending) return;
          event.preventDefault();
          event.stopPropagation();
          if (removeSidebarPane) {
            removeSidebarPane();
            finish();
          } else if (dragged.current) remove(dragged.current.pane);
        }}
      >
        <MarkButton
          label={
            selectedPane
              ? t("canvas.layoutRemoveNamed", { name: name(selectedPane) })
              : t("canvas.layoutRemove")
          }
          danger
          disabled={(!selectedPane && !removeSidebarPane) || pending}
          onClick={() => selectedPane && remove(selectedPane.id)}
        >
          <DeleteOutlineIcon sx={{ fontSize: SIZE }} />
        </MarkButton>
      </fieldset>
    ),
    box: (
      <section className="layout-box" aria-label={t("canvas.layout")}>
        <fieldset
          className="layout-bounds"
          aria-label={t("canvas.layout")}
          data-layout-canvas={id}
          onDragOver={(event) => {
            if (!layout || pending) return;
            if (moving(event)) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const target = targetAt(event);
              place(target);
              setOver(target?.edge ? null : (target?.target ?? null));
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setOver(null);
              place(null);
            }
          }}
          onDrop={(event) => {
            if (!layout || pending) return;
            if (moving(event) && dragged.current) {
              event.preventDefault();
              event.stopPropagation();
              const target = targetAt(event);
              if (target?.edge) dock(dragged.current.pane, target.edge, target.target);
              else if (target?.target) swap(dragged.current.pane, target.target);
              finish();
            }
          }}
        >
          <fieldset
            ref={map}
            tabIndex={-1}
            aria-label={t("canvas.layout")}
            className="layout-map"
            data-layout-canvas={id}
            aria-description={t("canvas.layoutHint")}
            style={{ "--layout-aspect": geometry.aspect } as CSSProperties}
            data-over={over === "canvas" || undefined}
          >
            {layout?.panes.map((pane) => {
              const rect = geometry.panes[pane.id];
              if (!rect) return null;
              return (
                <button
                  key={pane.id}
                  type="button"
                  className="layout-pane"
                  data-layout-pane={pane.id}
                  data-layout-kind={pane.kind}
                  data-over={over === pane.id || undefined}
                  aria-label={name(pane)}
                  aria-pressed={pane.id === selected}
                  aria-description={t("canvas.layoutHint")}
                  title={name(pane)}
                  disabled={pending}
                  draggable
                  style={{
                    left: `${100 * rect.left}%`,
                    top: `${100 * rect.top}%`,
                    width: `${100 * rect.width}%`,
                    height: `${100 * rect.height}%`,
                  }}
                  onClick={() => select(pane.id)}
                  onFocus={() => select(pane.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      event.stopPropagation();
                      remove(pane.id);
                    } else if (event.altKey && event.key.startsWith("Arrow")) {
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.shiftKey) {
                        const edge = {
                          ArrowLeft: "left",
                          ArrowRight: "right",
                          ArrowUp: "top",
                          ArrowDown: "bottom",
                        }[event.key] as Edge | undefined;
                        if (edge) dock(pane.id, edge);
                        return;
                      }
                      const index = layout.panes.findIndex((one) => one.id === pane.id);
                      const next = adjacentPane(
                        layout.panes.length,
                        index,
                        event.key,
                        geometry.aspect,
                        paneGrid(
                          layout.tree,
                          layout.panes.map((pane) => pane.id),
                          geometry.aspect,
                        ),
                      );
                      swap(pane.id, layout.panes[next].id);
                    }
                  }}
                  onDragStart={(event) => {
                    select(pane.id);
                    dragged.current = { session: layout.id, pane: pane.id };
                    event.dataTransfer.setData(DRAG_TYPE, pane.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={finish}
                >
                  <span>{name(pane)}</span>
                </button>
              );
            })}
            {preview && (
              <div
                className="layout-drop-preview"
                aria-hidden="true"
                style={{
                  left: `${100 * preview.left}%`,
                  top: `${100 * preview.top}%`,
                  width: `${100 * preview.width}%`,
                  height: `${100 * preview.height}%`,
                }}
              />
            )}
          </fieldset>
        </fieldset>
      </section>
    ),
  };
}
