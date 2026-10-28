import type {
  ComponentProps,
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  Ref,
  WheelEventHandler,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../lib/appSettings";
import { PageHeaderSlot } from "./PageWorkspace";
import "./page.css";

export type PageKind = "file-preview" | "settings-page" | "cli-page";

export type PageProps = {
  pageId?: string;
  placement?: "canvas" | "sidebar";
  keepMounted?: boolean;
  kind: PageKind;
  name: string;
  title?: string;
  tools?: ReactNode;
  heading?: ReactNode;
  toolsAtSide?: boolean;
  compact?: boolean;
  footnote?: ReactNode;
  collapsed?: boolean;
  pinned?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  onBodyWheel?: WheelEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  children?: ReactNode;
};

export function Page({
  pageId,
  placement = "canvas",
  keepMounted = false,
  kind,
  name,
  title,
  tools,
  heading,
  toolsAtSide = false,
  compact = false,
  footnote,
  collapsed = false,
  pinned = false,
  bodyRef,
  onBodyWheel,
  style,
  onPointerDown,
  onKeyDown,
  children,
}: PageProps) {
  const { t } = useTranslation();
  const draggable = !!pageId && placement === "canvas";
  return (
    <article
      className={`page page--${placement} ${kind}${collapsed ? " is-collapsed" : ""}${pinned ? " is-pinned" : ""}${toolsAtSide ? " page--tools-side" : ""}${compact ? " is-compact" : ""}`}
      tabIndex={-1}
      style={style}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      {toolsAtSide ? (
        <div
          className="page__tools page__drag"
          draggable={draggable}
          tabIndex={draggable ? 0 : undefined}
          aria-description={draggable ? t("page.reorder", { name }) : undefined}
          onPointerDown={(event) => {
            if (draggable)
              event.currentTarget.draggable = !(event.target as Element).closest("button");
          }}
          role="toolbar"
          aria-label={name}
          aria-orientation="vertical"
        >
          {tools}
        </div>
      ) : (
        <PageHeader
          name={name}
          heading={heading}
          title={title}
          draggable={draggable}
          tabIndex={draggable ? 0 : undefined}
          aria-description={draggable ? t("page.reorder", { name }) : undefined}
          onPointerDown={(event) => {
            if (!draggable) return;
            event.currentTarget.draggable = !(
              event.target instanceof Element && event.target.closest("button, input, select, a")
            );
          }}
        >
          {placement === "sidebar" && <span className="page__window-drag" data-tauri-drag-region />}
          {tools}
          {placement === "sidebar" && pageId && <PageHeaderSlot id={pageId} />}
        </PageHeader>
      )}

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

export function PageHeader({
  name,
  status,
  heading,
  children,
  style,
  ...props
}: ComponentProps<"header"> & {
  name: string;
  status?: ReactNode;
  heading?: ReactNode;
}) {
  const { cardText } = useAppSettings();
  return (
    <header
      {...props}
      className="page__header"
      style={{ fontSize: `${(11 * cardText) / 100}px`, ...style }}
    >
      {heading ?? (
        <div className="page__title">
          <span className="page__name">{name}</span>
          {status && <div className="page__status">{status}</div>}
        </div>
      )}
      {children}
    </header>
  );
}

export function PageTool({
  label,
  className,
  on,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`page__tool nodrag${on ? " is-on" : ""}${className ? ` ${className}` : ""}`}
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
