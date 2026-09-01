/**
 * The panel a page of the graph is drawn in.
 *
 * A file and the window's settings are the same thing out here: a box with a
 * bar across the top of it, standing over the graph, moved by that bar and
 * resized by its own edges. Everything that differs between the two is handed
 * in — what the bar carries after the name, and what is inside the box — so a
 * page is drawn once and read the same way whichever kind of page it is.
 *
 * The bar is the whole of the chrome. There is no border round the body, no
 * strip down the side and no second row of anything: what a page is showing is
 * what it is a page of, and the row above it is the only part of it that is
 * about the page rather than about what is in it.
 */

import { NodeResizeControl, NodeResizer, ResizeControlVariant } from "@xyflow/react";
import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  Ref,
  WheelEventHandler,
} from "react";

/** What a page is a page of. It is written on the box as a class, which is
 *  where the two kinds pick their own rules up from. */
export type PageKind = "file-preview" | "settings-page";

type PageProps = {
  kind: PageKind;
  /** What heads the page: a file's name, or what the page is called. */
  name: string;
  /** The whole of it, for a bar that only has room for the name. */
  title?: string;
  /** What the bar carries after the name — the marks and buttons this kind of
   *  page offers, in the order they are read. */
  tools?: ReactNode;
  /** A line under the body, for a page that is only showing part of what it
   *  holds. Drawn away with the body when the page is folded. */
  footnote?: ReactNode;
  /** Folded away: the bar and nothing else. */
  collapsed?: boolean;
  /** Taken off the canvas and drawn over it. */
  pinned?: boolean;
  /** The bar, for a page that measures it — its name is as much what the page
   *  is showing as its body is. */
  headerRef?: Ref<HTMLElement>;
  /** The box the body is drawn in, for a page that moves what is inside it
   *  rather than scrolling it. */
  bodyRef?: Ref<HTMLDivElement>;
  onBodyWheel?: WheelEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  children?: ReactNode;
};

export function Page({
  kind,
  name,
  title,
  tools,
  footnote,
  collapsed = false,
  pinned = false,
  headerRef,
  bodyRef,
  onBodyWheel,
  style,
  onPointerDown,
  onKeyDown,
  children,
}: PageProps) {
  return (
    <article
      className={`page ${kind}${collapsed ? " is-collapsed" : ""}${pinned ? " is-pinned" : ""}`}
      // A stop of the page's own, out of the way of tabbing: what is inside it
      // may take the focus itself or hold none at all, and either way the page
      // is the thing being read.
      tabIndex={-1}
      style={style}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      {/* The handle as well as the heading; `PAGE_HANDLE` is where React Flow
          is told so. */}
      <header className="page__header" title={title} ref={headerRef}>
        <span className="page__name">{name}</span>
        {tools}
      </header>

      {/* Folded, a page is its bar and nothing else — the body is taken down
          rather than hidden, so a page put away costs what a row costs. */}
      {!collapsed && (
        <div className="page__body nodrag nowheel" ref={bodyRef} onWheel={onBodyWheel}>
          {children}
        </div>
      )}
      {!collapsed && footnote && <footer className="page__footer">{footnote}</footer>}
    </article>
  );
}

/** One mark in the bar: what the page can be asked to do, or what it is already
 *  doing said in the same square. */
export function PageTool({
  label,
  on = false,
  onClick,
  children,
}: {
  label: string;
  /** Not an offer but an answer: the page is showing this already, and pressing
   *  it again puts back what it was showing before. */
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`page__tool nodrag${on ? " is-on" : ""}`}
      aria-label={label}
      onClick={(event) => {
        // The press belongs to the mark and stops there: the bar around it is
        // what the page is carried by, and the canvas under that is what a
        // press anywhere else would reach.
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/**
 * The edges a page is resized by.
 *
 * Nothing is drawn for them — see `page.css`, where the engine's own blue line
 * and corner squares are taken off. A page folded away is as tall as its bar
 * and the canvas measures that, so the only thing left to drag is how wide it
 * is: the two side edges alone, and no corners to pull a height out of.
 */
export function PageFrame({
  minWidth,
  minHeight,
  widthOnly = false,
}: {
  minWidth: number;
  minHeight: number;
  widthOnly?: boolean;
}) {
  if (widthOnly) {
    return (
      <>
        <NodeResizeControl
          className="page__edge"
          variant={ResizeControlVariant.Line}
          position="left"
          resizeDirection="horizontal"
          minWidth={minWidth}
        />
        <NodeResizeControl
          className="page__edge"
          variant={ResizeControlVariant.Line}
          position="right"
          resizeDirection="horizontal"
          minWidth={minWidth}
        />
      </>
    );
  }
  return (
    <NodeResizer
      minWidth={minWidth}
      minHeight={minHeight}
      lineClassName="page__edge"
      handleClassName="page__corner"
    />
  );
}
