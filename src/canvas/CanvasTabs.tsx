import { ClickAwayListener, Menu, MenuItem, MenuList, Paper, Popper } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cardGroups } from "../cards/groups";
import { displayPath, folderLabels } from "../folder/format";
import type { Folder } from "../hooks/useWorkspace";
import { terminal, typing } from "../lib/keys";
import { type Session, shellSession } from "../lib/session";
import { worktreeBranch } from "../lib/worktrees";
import { CloseMark, Frame, MarkButton } from "../marks";
import { usePageWorkspace } from "../page/PageWorkspace";
import type { Workspace } from "../types/git";
import { HEADER_HEIGHT } from "../window/WindowControls";
import { canvasOf, type useCanvasTabs } from "./useCanvasTabs";
import "./tabs.css";

export function CanvasTabs({
  tabs,
  activeTerminal,
  workspace,
  folders,
  onOpenSidebar,
  fail,
}: {
  tabs: ReturnType<typeof useCanvasTabs>;
  activeTerminal?: string;
  workspace: Workspace;
  folders: readonly Folder[];
  onOpenSidebar?: () => void;
  fail: () => void;
}) {
  const { t } = useTranslation();
  const sessions = tabs.terminals;
  const pages = usePageWorkspace();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [offered, setOffered] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const offerList = useRef<HTMLUListElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const activeCanvas = tabs.current?.id;
  const labels = useMemo(() => folderLabels(tabs.tabs.map((tab) => tab.cwd)), [tabs.tabs]);
  useEffect(() => {
    if (!activeCanvas) return;
    const tab = strip.current?.querySelector<HTMLElement>(".canvas-tab[data-active]");
    (activeTerminal
      ? tab?.querySelector<HTMLElement>('[aria-pressed="true"]')
      : tab
    )?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeCanvas, activeTerminal]);
  const choices = useMemo(() => {
    const cards = cardGroups(workspace.repositories, folders, sessions).flatMap(
      (group) => group.cards,
    );
    return [
      ...new Map<string, Pick<Session, "cwd" | "branch" | "folder">>([
        ...tabs.tabs.map((tab) => [tab.cwd, tab] as const),
        ...cards.map(
          (card) =>
            [
              card.path,
              {
                cwd: card.path,
                branch: card.worktree ? worktreeBranch(card.worktree) : card.name,
                folder: card.repository === null,
              },
            ] as const,
        ),
      ]).values(),
    ];
  }, [workspace, folders, sessions, tabs.tabs]);
  const pick = (id: string, terminal?: string) => {
    pages?.openSidebar();
    tabs.pick(id, terminal);
  };
  const closeOffer = (restore = true) => {
    if (restore && offerList.current?.contains(document.activeElement))
      previousFocus.current?.focus({ preventScroll: true });
    setOffered(null);
  };
  const create = (cwd: string) => {
    const choice = choices.find((choice) => choice.cwd === cwd);
    if (!choice) return;
    closeOffer();
    setMenu(null);
    pages?.openSidebar();
    tabs.openTab(shellSession(choice.cwd, choice.branch, choice.folder));
  };
  const latest = useRef({
    tabs,
    sessions,
    activeTerminal,
    pick,
    choices,
    offered,
    closeOffer,
    create,
  });
  latest.current = { tabs, sessions, activeTerminal, pick, choices, offered, closeOffer, create };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[event.key];
      const { choices, offered, closeOffer, create } = latest.current;
      if (offered !== null) {
        if (!event.ctrlKey || !event.shiftKey || event.key === "Escape") {
          closeOffer();
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        if (step || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Enter") {
            if (!event.repeat) create(offered);
          } else if (step && choices.length) {
            const at = choices.findIndex((choice) => choice.cwd === offered);
            const next = (at + step + choices.length) % choices.length;
            setOffered(choices[next].cwd);
            offerList.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[next]?.focus();
          }
        } else if (event.key !== "Control" && event.key !== "Shift") closeOffer();
        return;
      }
      if (
        event.ctrlKey &&
        event.shiftKey &&
        (event.key === "Control" || event.key === "Shift") &&
        !event.repeat
      ) {
        if (!choices.length || (typing(event.target) && !terminal(event.target))) return;
        if (document.querySelector('[data-selecting="true"], [role="dialog"], [role="menu"]'))
          return;
        previousFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // Keep copy/paste in the original input until an arrow enters the folder chooser.
        setOffered(latest.current.tabs.current?.cwd ?? choices[0].cwd);
        return;
      }
      if (!event.ctrlKey || event.shiftKey) return;
      if (!step) return;
      if (document.querySelector('[data-selecting="true"]')) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]'))
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const { tabs, sessions, activeTerminal, pick } = latest.current;
      const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const items = horizontal ? tabs.tabs : sessions;
      if (!items.length) return;
      const at = items.findIndex(
        (item) => item.id === (horizontal ? tabs.current?.id : activeTerminal),
      );
      const offset = horizontal ? step : -step;
      const next =
        items[
          at < 0 ? (offset > 0 ? 0 : items.length - 1) : (at + offset + items.length) % items.length
        ];
      if (horizontal) pick(next.id);
      else pick(canvasOf(next), next.id);
    };
    const release = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) latest.current.closeOffer();
    };
    const blur = () => latest.current.closeOffer(false);
    const hidden = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", release, true);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", release, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const items = choices.map((choice) => (
    <MenuItem key={choice.cwd} selected={choice.cwd === offered} onClick={() => create(choice.cwd)}>
      {displayPath(choice.cwd)}
    </MenuItem>
  ));
  return (
    <header className="canvas-header" style={{ height: HEADER_HEIGHT }}>
      {onOpenSidebar && (
        <div className="canvas-sidebar-reopen" data-sidebar-reopen="left">
          <MarkButton
            label={t("folder.expandSidebar")}
            aria-expanded={false}
            aria-controls="folder-sidebar"
            onClick={onOpenSidebar}
          >
            <Frame>
              <path d="M9 6 15 12 9 18" />
            </Frame>
          </MarkButton>
        </div>
      )}
      <div ref={strip} className="canvas-tabs" role="tablist" aria-label={t("canvas.tabs")}>
        {tabs.tabs.map((tab, index) => {
          const active = tab.id === tabs.current?.id;
          const members = sessions.filter((session) => canvasOf(session) === tab.id);
          return (
            <div className="canvas-tab" key={tab.id} data-active={active || undefined}>
              <div className="canvas-tab-title">
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  aria-label={displayPath(tab.cwd)}
                  title={displayPath(tab.cwd)}
                  onClick={() => pick(tab.id)}
                  onKeyDown={(event) => {
                    if (
                      event.ctrlKey ||
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    const at = tabs.tabs.findIndex((one) => one.id === tab.id);
                    const index =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.tabs.length - 1
                          : (at + (event.key === "ArrowLeft" ? -1 : 1) + tabs.tabs.length) %
                            tabs.tabs.length;
                    const next = event.currentTarget
                      .closest('[role="tablist"]')
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index];
                    pick(tabs.tabs[index].id);
                    next?.focus();
                  }}
                >
                  {labels[index]}
                </button>
              </div>
              <div
                className="canvas-tab-terminals"
                role="toolbar"
                aria-label={t("canvas.terminals")}
              >
                {members.map((session) => {
                  const number = sessions.indexOf(session) + 1;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      aria-label={t("canvas.selectTerminal", { number })}
                      aria-pressed={active && session.id === activeTerminal}
                      onClick={() => pick(tab.id, session.id)}
                    >
                      {number}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-label={t("canvas.openTerminal")}
                  onClick={() => {
                    pages?.openSidebar();
                    tabs.addTerminal(tab);
                  }}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="canvas-tab-close"
                aria-label={t("canvas.closeTab", { path: displayPath(tab.cwd) })}
                onClick={() => void tabs.close(tab.id).catch(fail)}
              >
                <CloseMark />
              </button>
            </div>
          );
        })}
      </div>
      <button
        ref={addButton}
        className="canvas-add-tab"
        type="button"
        aria-label={t("canvas.newTab")}
        aria-haspopup="menu"
        aria-expanded={menu !== null || offered !== null}
        data-offering={offered !== null || undefined}
        disabled={!choices.length}
        onClick={(event) => {
          closeOffer();
          setMenu(event.currentTarget);
        }}
      >
        +
      </button>
      <div className="canvas-header-space" data-tauri-drag-region />
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        {items}
      </Menu>
      <Popper
        open={offered !== null}
        anchorEl={addButton.current}
        placement="bottom-start"
        sx={{ zIndex: "modal" }}
      >
        <ClickAwayListener onClickAway={() => closeOffer()}>
          <Paper
            sx={{
              maxHeight: "calc(100vh - 64px)",
              maxWidth: "calc(100vw - 32px)",
              overflow: "auto",
            }}
          >
            <MenuList ref={offerList} aria-label={t("canvas.newTab")}>
              {items}
            </MenuList>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </header>
  );
}
