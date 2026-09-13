import CloseIcon from "@mui/icons-material/Close";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
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
  onShrink,
}: {
  data: FilePreviewNodeData;
  changed: boolean;
  save: () => Promise<boolean>;
  onFit: () => void;
  onShrink: () => void;
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
        value={drawn(data.view) ? "preview" : data.view === "schema" ? "schema" : "text"}
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

      <PageTool label={t("filePreview.shrink", { name: data.name })} onClick={onShrink}>
        <CloseFullscreenIcon sx={{ fontSize: 12 }} />
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
