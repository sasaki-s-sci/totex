import { useTranslation } from "react-i18next";
import type { CanvasProps } from "../canvas/CanvasProps";
import { Frame } from "../marks";
import { PageHeader, PageTool } from "../page/Page";
import { PageView } from "../page/PageView";
import { PagePortal, PageSlot, usePageWorkspace } from "../page/PageWorkspace";
import { terminalPageId } from "../page/placement";
import { HEADER_HEIGHT, HEADER_MARKS } from "../window/WindowControls";
import { Sidebar, type Sizing } from "./Sidebar";
import { SidebarReopen } from "./SidebarReopen";
import "./sessions.css";

const SIZING: Sizing = { min: 260, max: 1100, initial: 420, storageKey: "totex.panel.width" };

export function RightSidebar({
  sessions,
  showing,
  onEndSession,
}: Pick<
  CanvasProps,
  "workspace" | "folders" | "sessions" | "showing" | "onOpenWork" | "onEndSession"
>) {
  const { t } = useTranslation();
  const pages = usePageWorkspace();
  const open = pages?.sidebarOpen ?? true;
  const current = sessions.find((session) => session.id === showing);
  const heading = pages ? (
    <PageTool label={t("page.hideSidebar")} onClick={pages.hide}>
      <Frame size={12}>
        <path d="M9 6 15 12 9 18" />
      </Frame>
    </PageTool>
  ) : (
    false
  );
  return (
    <>
      <Sidebar
        id="cli-sidebar"
        component="aside"
        side="right"
        open={open}
        aria-hidden={!open}
        inert={!open}
        sizing={SIZING}
        band={
          current ? null : (
            <div className="page--sidebar session-empty-header">
              <PageHeader name="" heading={heading}>
                <span className="page__window-drag" data-tauri-drag-region />
                <span className="page__window-controls" aria-hidden="true" />
              </PageHeader>
            </div>
          )
        }
        sx={{
          maxWidth: "40vw",
          minWidth: 180,
          // Hidden terminals still need their real grid to attach and replay before frontend-ready.
          ...(!open && {
            position: "absolute",
            inset: "0 0 0 auto",
            display: "flex",
            visibility: "hidden",
            pointerEvents: "none",
          }),
          "--page-header-height": `${HEADER_HEIGHT}px`,
          "--session-header-reserve": `${HEADER_MARKS}px`,
        }}
      >
        <div className="session-terminal-area">
          {sessions.map((session) => {
            const id = terminalPageId(session.id);
            const active = session.id === current?.id;
            return (
              <div key={id} className="session-terminal" hidden={!active} inert={!active}>
                <PageSlot id={id} place="sidebar" />
                <PagePortal
                  id={id}
                  name={session.branch}
                  folder={session.cwd}
                  place="sidebar"
                  focus={active && open ? ".xterm-helper-textarea" : undefined}
                >
                  <PageView
                    kind="terminal"
                    session={session}
                    placement="sidebar"
                    scale={1}
                    shown={active && open}
                    heading={active ? heading : undefined}
                    compact={false}
                    controls={{}}
                    onEnded={() => onEndSession(session, true)}
                  />
                </PagePortal>
              </div>
            );
          })}
          {!current && (
            <div className="session-terminal-empty">
              <Frame>
                <path d="m5 6 6 6-6 6M13 18h6" />
              </Frame>
            </div>
          )}
        </div>
      </Sidebar>
      {!open && pages && <SidebarReopen side="right" onClick={pages.openSidebar} />}
    </>
  );
}
