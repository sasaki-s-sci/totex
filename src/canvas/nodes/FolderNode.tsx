import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { FolderFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { CliMark, CloseMark, FolderMark } from "../../marks";
import { changeClass, useChanges } from "../changes";
import { useGraphActions } from "../graphActions";
import { FOLDER_HOLD, useMarkSizes } from "../markSizes";

/** The close's width, ahead of the mark. */
const FOLDER_CLOSE = 22;

export function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const { t } = useTranslation();
  const marks = useMarkSizes();
  // A large mark widens its grip; a small one keeps the room a pointer needs.
  const hold = Math.max(FOLDER_HOLD, marks.folder);
  // What the grip grows by on each side: its centre stays where the layout put the mark's.
  const grown = (hold - FOLDER_HOLD) / 2;
  const { root, name, label, open, mark } = data;
  const { openWork, closeFolder } = useGraphActions();
  // The top of the climb: what every repository under the folder comes to.
  const change = useChanges().folders.get(root);

  return (
    <div className="band folder">
      {/* On top of the terminals beside the mark, as a heading over its column. Only a name: a folder holds nothing to fold. */}
      <div
        className="row__name row__name--above"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
        <Typography
          className={`folder__name folder__name--still${changeClass(change)}`}
          variant="body2"
          sx={{ minWidth: 0, fontWeight: "normal" }}
          noWrap
        >
          {name}
        </Typography>
      </div>

      {/* Over the mark, as a branch's is over its ring. */}
      <button
        type="button"
        className="row__cli tools__button nopan"
        style={{ left: mark, ...(grown > 0 ? { top: `calc(50% - 26px - ${grown}px)` } : null) }}
        aria-label={t("folder.shell")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openWork({ repository: null, branch: name, cwd: root });
        }}
      >
        <CliMark size={marks.cli} />
      </button>

      {/* The close comes out ahead of the mark under the pointer; one box holds both, so it stays while the pointer goes to it. */}
      <div className="folder__mark" style={{ left: mark - FOLDER_CLOSE - grown, height: hold }}>
        <button
          type="button"
          className="folder__close nopan"
          aria-label={t("folder.takeOff")}
          title={t("folder.takeOff")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            closeFolder(root);
          }}
        >
          <CloseMark />
        </button>
        {/* The mark is the drag handle and deliberately not a button: a button would fire on every drag that came to nothing. */}
        <div
          className={`${GRIP} nopan`}
          title={t("folder.move")}
          style={{ width: hold, height: hold }}
        >
          <FolderMark on={open} size={marks.folder} />
        </div>
      </div>
    </div>
  );
}
