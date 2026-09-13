/**
 * A terminal stood on the canvas: the same emulator the panel draws, in the
 * panel every page of this canvas is drawn in.
 *
 * The process is not moved by this — a session is a pty, and it runs the same
 * wherever its rows are drawn. What moves is the drawing: the panel stops, the
 * page starts, and the shell hands the page everything it has said so far. So
 * a terminal can be left standing beside the branch it is working on, read
 * against the file cards around it, and put back in the panel when it is done.
 * Shown in the panel again while it stands here, the panel follows the page —
 * the page is the one that measures the shell, and the panel draws what it
 * settled on. See `cliGrid`.
 *
 * The rows are drawn at the pixels they are shown at, whatever the canvas is
 * zoomed to: the emulator draws to a canvas, and a canvas stretched to the
 * zoom is a blur, so the page draws it `zoom` times larger and scales it back
 * down — see `scale` on `CliView`. Told a little after the zoom settles rather
 * than on every frame of it, because a change of face has the emulator
 * remeasure and redraw every cell, and the zoom changes on every frame of a
 * pinch; through the frames between, the old drawing is stretched, and then
 * it is exact again.
 */

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

/** The smallest box a terminal is still worth drawing in: about forty columns
 *  and eight rows of the panel's face. */
export const MIN_WIDTH = 300;
export const MIN_HEIGHT = 140;
/** How long the zoom has to hold still before the rows are redrawn to it. */
const SETTLE_MS = 150;

export function CliPageNode({ data }: NodeProps<CliPageFlowNode>) {
  return (
    <>
      <PageFrame minWidth={MIN_WIDTH} minHeight={MIN_HEIGHT} widthOnly={data.collapsed} />
      <CliPage data={data} />
    </>
  );
}

/** The canvas's zoom, a moment after it last changed. */
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
  // The emulator, fetched the first time a page is opened: a window whose panel
  // has been up already has it, and one that has never opened a terminal pays
  // for it here rather than on the way to the first column.
  const Terminal = terminalPart.use(true);

  // The bar reads the way a file card's does: what the page is, then where it
  // stands, then how much of it is drawn — with the marks a terminal has no
  // use for left out rather than replaced. A file card's mode and patch are the
  // file's own; the pin is the dock, because both say where the page stands;
  // and a terminal is not closed from its bar, because closing one is ending
  // the process in it, and that is the one press on the canvas that cannot be
  // taken back — it stays on the mark beside the branch, faint until it is
  // reached for.
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
      {/* The rows are the terminal's: a drag in them is a selection and a turn
          of the wheel is the scrollback, and neither is the canvas's to answer.
          The keys go to the page as it is stood up, and after that to whichever
          drawing of the shell was reached for — the panel, when it is showing
          the same one, is not fought for them. */}
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
