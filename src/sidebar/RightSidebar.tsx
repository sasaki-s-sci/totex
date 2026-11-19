import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasProps } from "../canvas/CanvasProps";
import { cardGroups } from "../cards/groups";
import { useCardOffers } from "../cards/useCardOffers";
import { displayPath } from "../folder/format";
import { worktreeBranch } from "../lib/worktrees";
import { Frame } from "../marks";
import { PageHeader } from "../page/Page";
import { PageView } from "../page/PageView";
import { PagePortal, PageSlot } from "../page/PageWorkspace";
import { terminalPageId } from "../page/placement";
import { TerminalList } from "../page/TerminalList";
import { HEADER_HEIGHT, HEADER_MARKS } from "../window/WindowControls";
import { Sidebar, type Sizing } from "./Sidebar";
import "./sessions.css";

const SIZING: Sizing = { min: 260, max: 1100, initial: 420, storageKey: "totex.panel.width" };

export function RightSidebar({
  workspace,
  folders,
  sessions,
  showing,
  onOpenWork,
  onEndSession,
}: Pick<
  CanvasProps,
  "workspace" | "folders" | "sessions" | "showing" | "onOpenWork" | "onEndSession"
>) {
  const { t } = useTranslation();
  const groups = useMemo(
    () => cardGroups(workspace.repositories, folders, sessions),
    [workspace, folders, sessions],
  );
  const offered = useCardOffers(groups, onOpenWork);
  const available = groups
    .flatMap((group) => group.cards)
    .filter((folder) => !folder.sessions.length);
  const selection = useRef<HTMLButtonElement>(null);
  const current = sessions.find((session) => session.id === showing) ?? sessions[0];
  useEffect(() => {
    if (offered) selection.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [offered]);
  const heading = (
    <TerminalList>
      {available.map((folder) => (
        <button
          key={folder.path}
          ref={folder.path === offered ? selection : undefined}
          type="button"
          className="page__terminal-group session-offer"
          data-offered={folder.path === offered || undefined}
          aria-current={folder.path === offered ? "true" : undefined}
          aria-label={t("canvas.start", { name: folder.name })}
          title={displayPath(folder.path)}
          onClick={() =>
            onOpenWork({
              repository: folder.repository,
              cwd: folder.path,
              branch: folder.worktree ? worktreeBranch(folder.worktree) : folder.name,
            })
          }
        >
          <span className="page__terminal-name">{folder.name}</span>
        </button>
      ))}
    </TerminalList>
  );
  return (
    <Sidebar
      id="cli-sidebar"
      component="aside"
      side="right"
      open
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
                focus={active ? ".xterm-helper-textarea" : undefined}
              >
                <PageView
                  kind="terminal"
                  session={session}
                  placement="sidebar"
                  scale={1}
                  shown={active}
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
            <p>{t("canvas.startHint")}</p>
          </div>
        )}
      </div>
    </Sidebar>
  );
}
