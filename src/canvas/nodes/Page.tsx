import { NodeResizeControl, NodeResizer, ResizeControlVariant } from "@xyflow/react";
import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  Ref,
  WheelEventHandler,
} from "react";

export type PageKind = "file-preview" | "settings-page" | "cli-page";

type PageProps = {
  kind: PageKind;
  name: string;
  title?: string;
  tools?: ReactNode;
  footnote?: ReactNode;
  collapsed?: boolean;
  pinned?: boolean;
  headerRef?: Ref<HTMLElement>;
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
      tabIndex={-1}
      style={style}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <header className="page__header" title={title} ref={headerRef}>
        <span className="page__name">{name}</span>
        {tools}
      </header>

      {/* Folded, the body is unmounted rather than hidden: a page put away costs what a row costs. */}
      {!collapsed && (
        <div className="page__body nodrag nowheel" ref={bodyRef} onWheel={onBodyWheel}>
          {children}
        </div>
      )}
      {!collapsed && footnote && <footer className="page__footer">{footnote}</footer>}
    </article>
  );
}

export function PageTool({
  label,
  on = false,
  onClick,
  children,
}: {
  label: string;
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
        // The bar around the mark is the drag handle, so the press stops here.
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** A folded page is as tall as its bar, so only the side edges are left to drag. */
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
