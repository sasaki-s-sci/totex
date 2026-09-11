/**
 * A terminal stood on the canvas: the same emulator the panel draws, in the
 * panel every page of this canvas is drawn in.
 *
 * The process is not moved by this — a session is a pty, and it runs the same
 * wherever its rows are drawn. What moves is the drawing: the panel stops, the
 * page starts, and the shell hands the page everything it has said so far. So
 * a terminal can be left standing beside the branch it is working on, read
 * against the file cards around it, and put back in the panel when it is done.
 *
 * The rows are drawn at the canvas's own scale, which is what makes the page
 * one thing among the others on the canvas — and what means the pointer inside
 * it is only exact at full size: the emulator measures its cells in the page's
 * own pixels, and a canvas zoomed out draws those cells smaller than it thinks
 * they are. Typing is unaffected; a selection dragged out at half size lands a
 * little off. Full size is where a terminal is read anyway.
 */

import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { CliPageFlowNode, CliPageNodeData } from "../../lib/graph";
import { terminalPart } from "../../parts";
import { useGraphActions } from "../graphActions";
import { Page, PageFrame, PageTool } from "./Page";

/** The smallest box a terminal is still worth drawing in: about forty columns
 *  and eight rows of the panel's face. */
const MIN_WIDTH = 300;
const MIN_HEIGHT = 140;

export function CliPageNode({ data }: NodeProps<CliPageFlowNode>) {
  return (
    <>
      <PageFrame minWidth={MIN_WIDTH} minHeight={MIN_HEIGHT} widthOnly={data.collapsed} />
      <CliPage data={data} />
    </>
  );
}

function CliPage({ data }: { data: CliPageNodeData }) {
  const { t } = useTranslation();
  const { session, showing, collapsed } = data;
  const { dockSession, endSession, collapseCliPage } = useGraphActions();
  // The emulator, fetched the first time a page is opened: a window whose panel
  // has been up already has it, and one that has never opened a terminal pays
  // for it here rather than on the way to the first column.
  const Terminal = terminalPart.use(true);

  return (
    <Page
      kind="cli-page"
      name={session.branch}
      title={session.cwd}
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
        </>
      }
    >
      {/* The rows are the terminal's: a drag in them is a selection and a turn
          of the wheel is the scrollback, and neither is the canvas's to answer. */}
      <div className="cli-page__terminal nodrag nopan nowheel">
        {Terminal ? (
          <Terminal session={session} shown={showing} onEnded={() => endSession(session)} />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        )}
      </div>
    </Page>
  );
}
