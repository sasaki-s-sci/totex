import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  Ref,
  WheelEventHandler,
} from "react";
import { PageName } from "./PageName";
import "./page.css";

export type PageKind = "file-preview" | "settings-page" | "cli-page";

export type PageProps = {
  placement?: "canvas" | "sidebar";
  pageId?: string;
  keepMounted?: boolean;
  kind: PageKind;
  name: string;
  title?: string;
  tools?: ReactNode;
  status?: ReactNode;
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
  placement = "canvas",
  pageId,
  keepMounted = false,
  kind,
  name,
  title,
  tools,
  status,
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
      className={`page page--${placement} ${kind}${collapsed ? " is-collapsed" : ""}${pinned ? " is-pinned" : ""}`}
      tabIndex={-1}
      style={style}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <header className="page__header" title={title} ref={headerRef}>
        {placement === "sidebar" && <span className="page__window-drag" data-tauri-drag-region />}
        <PageName id={pageId} name={name} placement={placement} />
        {tools}
        {status && <div className="page__status">{status}</div>}
      </header>

      {/* Stateful runtimes such as xterm stay mounted even while folded. */}
      {(!collapsed || keepMounted) && (
        <div
          className="page__body nodrag nowheel"
          hidden={collapsed}
          ref={bodyRef}
          onWheel={onBodyWheel}
        >
          {children}
        </div>
      )}
      {!collapsed && footnote && <footer className="page__footer">{footnote}</footer>}
    </article>
  );
}

export function PageTool({
  label,
  on,
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
      title={label}
      aria-pressed={on}
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
