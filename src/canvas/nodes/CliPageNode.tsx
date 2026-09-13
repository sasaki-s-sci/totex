import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import { type NodeProps, useStore } from "@xyflow/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { displayPath } from "../../folder/format";
import { useAppSettings } from "../../lib/appSettings";
import type { CliPageFlowNode, CliPageNodeData } from "../../lib/graph";
import { terminalPart } from "../../parts";
import { useGraphActions } from "../graphActions";
import { Page, PageFrame, PageTool } from "./Page";

export const MIN_WIDTH = 300;
export const MIN_HEIGHT = 140;
const SETTLE_MS = 150;

export function CliPageNode({ data }: NodeProps<CliPageFlowNode>) {
  return (
    <>
      <PageFrame minWidth={MIN_WIDTH} minHeight={MIN_HEIGHT} widthOnly={data.collapsed} />
      <CliPage data={data} />
    </>
  );
}

// The rows are drawn `zoom` times larger and scaled back so xterm's canvas is not stretched;
// told only once the zoom settles, since a face change redraws every cell.
function useSettledZoom(): number {
  const zoom = useStore((state) => state.transform[2]);
  const [settled, setSettled] = useState(zoom);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(Math.round(zoom * 100) / 100), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [zoom]);
  return settled;
}

function CliPage({ data }: { data: CliPageNodeData }) {
  const { t } = useTranslation();
  const { fileTitle } = useAppSettings();
  const { session, collapsed } = data;
  const { dockSession, endSession, collapseCliPage, fitCliPage } = useGraphActions();
  const scale = useSettledZoom();
  const Terminal = terminalPart.use(true);

  return (
    <Page
      kind="cli-page"
      name={fileTitle === "path" ? displayPath(session.cwd) : session.branch}
      title={displayPath(session.cwd)}
      collapsed={collapsed}
      tools={
        <>
          <PageTool
            label={t("cli.dock", { name: session.branch })}
            onClick={() => dockSession(session)}
          >
            <ViewSidebarOutlinedIcon sx={{ fontSize: 12 }} />
          </PageTool>
          <PageTool
            label={t(collapsed ? "filePreview.expand" : "filePreview.collapse", {
              name: session.branch,
            })}
            onClick={() => collapseCliPage(session.id)}
          >
            {collapsed ? (
              <KeyboardArrowDownIcon sx={{ fontSize: 12 }} />
            ) : (
              <KeyboardArrowUpIcon sx={{ fontSize: 12 }} />
            )}
          </PageTool>
          <PageTool
            label={t("filePreview.shrink", { name: session.branch })}
            onClick={() => fitCliPage(session.id, MIN_WIDTH, MIN_HEIGHT)}
          >
            <CloseFullscreenIcon sx={{ fontSize: 12 }} />
          </PageTool>
        </>
      }
    >
      <div className="cli-page__terminal nodrag nopan nowheel">
        {Terminal ? (
          <Terminal
            session={session}
            shown={false}
            autoFocus
            scale={scale}
            onEnded={() => endSession(session)}
          />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        )}
      </div>
    </Page>
  );
}
