import { useTranslation } from "react-i18next";
import type { FilePreviewNodeData } from "../lib/graph";
import type { FilePageActions } from "./actions";

/**
 * Said in the header while a page has stopped following its file: it was deleted, or it changed
 * the same place the page did. The page goes on as it is until one of these is pressed.
 */
export function FileStanding({
  data,
  actions,
  gone,
  savable,
  save,
}: {
  data: FilePreviewNodeData;
  actions: FilePageActions;
  gone: boolean;
  savable: boolean;
  save: () => void;
}) {
  const { t } = useTranslation();
  const { openFileAgain, closeFilePreview } = actions;
  return (
    <span
      className={`file-standing nodrag ${gone ? "is-gone" : "is-clash"}`}
      role="status"
      title={t(gone ? "filePreview.goneTitle" : "filePreview.clashTitle", { name: data.name })}
    >
      <span className="file-standing__mark">
        {t(gone ? "filePreview.gone" : "filePreview.clash")}
      </span>
      {savable && (
        <button type="button" onClick={save}>
          {t(gone ? "filePreview.saveAnew" : "filePreview.saveOver")}
        </button>
      )}
      {gone ? (
        <button type="button" onClick={() => closeFilePreview(data.requestId)}>
          {t("filePreview.closeNow")}
        </button>
      ) : (
        openFileAgain && (
          <button type="button" onClick={() => openFileAgain(data.requestId)}>
            {t("filePreview.openAgain")}
          </button>
        )
      )}
    </span>
  );
}
