/**
 * What a file's bar carries, which is what the card is holding.
 *
 * A reading offers its patch and the page the file is written to be; a drawing
 * offers neither — there is nothing to compare a picture against, and a
 * rendering of a rendering is the card it is standing beside. What is left is
 * true of every card whatever is in it: it can be taken off the canvas, fitted
 * to what it is showing, folded away and closed. So the row is the kind of file
 * said in marks, and it is read in that order — what this card can do first,
 * what any card can do after it.
 */

import CloseIcon from "@mui/icons-material/Close";
import DifferenceIcon from "@mui/icons-material/Difference";
import HeightIcon from "@mui/icons-material/Height";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { useTranslation } from "react-i18next";
import { useSettingsDocument } from "../../../lib/appSettings";
import { drawn, type FilePreviewView, previewable, previewView } from "../../../lib/filePreview";
import type { FilePreviewNodeData } from "../../../lib/graph";
import { useGraphActions } from "../../graphActions";
import { PageTool } from "../Page";

export function FileTools({
  data,
  changed,
  save,
  onFit,
}: {
  data: FilePreviewNodeData;
  /** The commit under the file disagrees with it, so there is a patch to turn
   *  the reading over to. */
  changed: boolean;
  /** What is being typed goes to disk before anything that redraws the card:
   *  the patch is against what is on screen, and so is the page. */
  save: () => Promise<boolean>;
  onFit: () => void;
}) {
  const { t } = useTranslation();
  const config = useSettingsDocument();
  const isSettings = config?.path === data.path;
  const { closeFilePreview, collapseFilePreview, setFilePreviewView, pinFilePreview } =
    useGraphActions();

  return (
    <>
      <select
        className="file-preview__mode nodrag"
        aria-label={t("filePreview.mode")}
        value={
          data.view === "settings" || data.view === "markdown" || data.view === "picture"
            ? "preview"
            : data.view === "schema"
              ? "schema"
              : "text"
        }
        onChange={(event) => {
          const mode = event.target.value;
          const next: FilePreviewView =
            mode === "preview"
              ? isSettings
                ? "settings"
                : previewView(data.path)
              : mode === "schema"
                ? "schema"
                : "text";
          void save().then((saved) => saved && setFilePreviewView(data.requestId, next));
        }}
      >
        <option
          value="preview"
          disabled={!isSettings && !previewable(data.path) && data.picture === null}
        >
          Preview
        </option>
        <option value="text" disabled={data.state === "ready" && data.text === null}>
          Native
        </option>
        <option value="schema" disabled={!/\.json$/i.test(data.path)}>
          Schemaed
        </option>
      </select>
      {/* The patch, in place of the reading. Drawn only while there is one,
          which is the same moment the gutter has bars in it: a file the commit
          under it agrees with has nothing to turn over to. */}
      {!isSettings && !drawn(data.view) && changed && (
        <PageTool
          label={t(data.view === "diff" ? "filePreview.showFile" : "filePreview.showDiff", {
            name: data.name,
          })}
          on={data.view === "diff"}
          onClick={() =>
            void save().then(
              (saved) =>
                saved && setFilePreviewView(data.requestId, data.view === "diff" ? "text" : "diff"),
            )
          }
        >
          <DifferenceIcon sx={{ fontSize: 12 }} />
        </PageTool>
      )}

      {/* Pinned, the card leaves the canvas and is drawn over it: the graph is
          dragged, zoomed and laid out again underneath, and the reading stays
          where it was put. A pin driven in is a pin that is holding something,
          which is why the mark fills in rather than changes. */}
      <PageTool
        label={t(data.pinnedAt ? "filePreview.unpin" : "filePreview.pin", { name: data.name })}
        onClick={() => void save().then((saved) => saved && pinFilePreview(data.requestId))}
      >
        {data.pinnedAt ? (
          <PushPinIcon sx={{ fontSize: 12 }} />
        ) : (
          <PushPinOutlinedIcon sx={{ fontSize: 12 }} />
        )}
      </PageTool>

      {/* Sideways: the arrow points the two ways the card is being asked to
          move, which is the whole of what this does. The reading is not
          reflowed and the file is not touched — only the edges go out to the
          longest line, or in to it. */}
      <PageTool label={t("filePreview.fitWidth", { name: data.name })} onClick={onFit}>
        <HeightIcon sx={{ fontSize: 12, transform: "rotate(90deg)" }} />
      </PageTool>

      <PageTool
        label={t(data.collapsed ? "filePreview.expand" : "filePreview.collapse", {
          name: data.name,
        })}
        onClick={() => void save().then((saved) => saved && collapseFilePreview(data.requestId))}
      >
        {data.collapsed ? (
          <KeyboardArrowDownIcon sx={{ fontSize: 12 }} />
        ) : (
          <KeyboardArrowUpIcon sx={{ fontSize: 12 }} />
        )}
      </PageTool>

      <PageTool
        label={t("filePreview.close", { name: data.name })}
        onClick={() => void save().then((saved) => saved && closeFilePreview(data.requestId))}
      >
        <CloseIcon sx={{ fontSize: 12 }} />
      </PageTool>
    </>
  );
}
