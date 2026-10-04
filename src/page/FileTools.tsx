import DifferenceIcon from "@mui/icons-material/Difference";
import WrapTextIcon from "@mui/icons-material/WrapText";
import { useTranslation } from "react-i18next";
import { useSettingsDocument } from "../lib/appSettings";
import { drawn } from "../lib/filePreview";
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
  wrapped,
  onWrap,
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
  wrapped: boolean;
  /** Absent where the page shows no text to wrap. */
  onWrap?: () => void;
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
      {onWrap && (
        <PageTool
          label={t(wrapped ? "filePreview.unwrap" : "filePreview.wrap", { name: data.name })}
          on={wrapped}
          onClick={onWrap}
        >
          <WrapTextIcon sx={{ fontSize: 12 }} />
        </PageTool>
      )}
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
