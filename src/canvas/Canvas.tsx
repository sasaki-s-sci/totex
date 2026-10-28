import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CardBoard } from "../cards/CardBoard";
import { SETTINGS_REQUEST_ID } from "../lib/filePreview";
import type { AppNode, FilePreviewFlowNode } from "../lib/graph";
import { useMonitorShots } from "../monitor/runtime";
import { usePageWorkspace } from "../page/PageWorkspace";
import { filePageId } from "../page/placement";
import { frontValue, readOnSnapshot } from "../shell/state";
import type { CanvasProps } from "./CanvasProps";
import { GraphActionsProvider } from "./graphActions";
import { useFilePreviews } from "./hooks/useFilePreviews";
import { useSettingsPage } from "./hooks/useSettingsPage";
import { Pages } from "./Pages";
import "./styles/index.css";

export type { CanvasProps } from "./CanvasProps";
export type { BranchPick, FetchRequest } from "./graphActions";

export function Canvas({
  workspace,
  folders,
  sessions,
  showing,
  onNewWork,
  onOpenWork,
  onBrowseWorktree,
  onPickBranch,
  onCloseRepository,
  onCloseFolder,
  onEndSession,
  filePreviews,
  onPreviewFile,
  onCloseFilePreview,
  settingsRequest,
  onCloseSettings,
}: CanvasProps) {
  const pages = usePageWorkspace();
  const [nodes, setNodes] = useState<AppNode[]>(() =>
    (frontValue<FilePreviewFlowNode[]>("canvas.files") ?? []).map((node) => ({
      ...node,
      hidden: false,
      data: { ...node.data, collapsed: false, pinnedAt: null },
    })),
  );
  const standing = useRef(nodes);
  standing.current = nodes;
  useLayoutEffect(() => readOnSnapshot("canvas.files", () => standing.current), []);
  const state = { standing, nodes, setNodes };
  const fileActions = useFilePreviews(filePreviews, state, onPreviewFile);
  useSettingsPage(settingsRequest, state);
  useMonitorShots((path) => onPreviewFile(path, -1));
  const placement = pages?.placement;
  const showPage = pages?.show;
  const forgetPage = pages?.forget;
  const lastSettings = useRef(settingsRequest);
  useEffect(() => {
    const id = filePageId(SETTINGS_REQUEST_ID);
    if (
      settingsRequest !== lastSettings.current &&
      settingsRequest &&
      placement?.(id) === "sidebar"
    )
      showPage?.(id);
    lastSettings.current = settingsRequest;
  }, [settingsRequest, placement, showPage]);
  const closePage = useCallback(
    (id: number) => {
      forgetPage?.(filePageId(id));
      if (id === SETTINGS_REQUEST_ID) onCloseSettings();
      else onCloseFilePreview(id);
    },
    [onCloseSettings, onCloseFilePreview, forgetPage],
  );
  const actions = {
    ...fileActions,
    closeFilePreview: closePage,
    openWork: onOpenWork,
    newWork: onNewWork,
    browseWorktree: onBrowseWorktree,
    pickBranch: onPickBranch,
    closeRepository: onCloseRepository,
    closeFolder: onCloseFolder,
    endSession: onEndSession,
  };
  return (
    <GraphActionsProvider value={actions}>
      <div
        className="cards-workspace"
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        <CardBoard
          workspace={workspace}
          folders={folders}
          sessions={sessions}
          showing={showing}
          nodes={nodes}
        />
        <Pages nodes={nodes} sessions={sessions} />
      </div>
    </GraphActionsProvider>
  );
}
