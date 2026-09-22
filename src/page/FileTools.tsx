import DifferenceIcon from "@mui/icons-material/Difference";
import { useTranslation } from "react-i18next";
import { useSettingsDocument } from "../lib/appSettings";
import { drawn, type FilePreviewView, previewable, previewView } from "../lib/filePreview";
import type { FilePreviewNodeData } from "../lib/graph";
import type { FilePageActions } from "./actions";
import { PageTool } from "./Page";
import { PageTools } from "./PageTools";
import type { PagePlacement } from "./placement";

export function FileTools({
  data,
  actions,
  placement,
  onMove,
  onHide,
  changed,
  save,
  onFit,
  onShrink,
}: {
  data: FilePreviewNodeData;
  actions: FilePageActions;
  placement: PagePlacement;
  onMove?: () => void;
  onHide?: () => void;
  changed: boolean;
  save: () => Promise<boolean>;
  onFit: () => void;
  onShrink: () => void;
}) {
  const { t } = useTranslation();
  const config = useSettingsDocument();
  const isSettings = config?.path === data.path;
  const { closeFilePreview, collapseFilePreview, setFilePreviewView, pinFilePreview } = actions;

  const afterSave = (action: () => void) => () => {
    void save().then((saved) => saved && action());
  };
  return (
    <PageTools
      name={data.name}
      placement={placement}
      collapsed={data.collapsed}
      pinned={data.pinnedAt !== null}
      controls={{
        move: onMove && afterSave(onMove),
        hide: onHide,
        pin: afterSave(() => pinFilePreview(data.requestId)),
        fit: onFit,
        collapse: afterSave(() => collapseFilePreview(data.requestId)),
        shrink: onShrink,
        close: afterSave(() => closeFilePreview(data.requestId)),
      }}
    >
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
    </PageTools>
  );
}
