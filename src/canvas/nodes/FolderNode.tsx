import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { FolderFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { CliMark, FolderMark, Frame } from "../../marks";
import { changeClass, useChanges } from "../changes";
import { useGraphActions } from "../graphActions";
import { FOLDER_HOLD, useMarkSizes } from "../markSizes";

/** Both controls precede the grip without moving its centre. */
const FOLDER_CONTROLS = 44;

export function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const { t } = useTranslation();
  const marks = useMarkSizes();
  // A large mark widens its grip; a small one keeps the room a pointer needs.
  const hold = Math.max(FOLDER_HOLD, marks.folder);
  // What the grip grows by on each side: its centre stays where the layout put the mark's.
  const grown = (hold - FOLDER_HOLD) / 2;
  const { root, name, label, open, mark } = data;
  const { openWork, minimizeFolder, closeFolder } = useGraphActions();
  // The top of the climb: what every repository under the folder comes to.
  const change = useChanges().folders.get(root);

  return (
    <div className="band folder">
      {/* Over the mark's shell glyph, as a heading over its column, rising with it. Only a name: a folder holds nothing to fold. */}
      <div
        className="row__name row__name--above"
        style={{ left: label.x, top: label.y - grown, width: label.width, height: label.height }}
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

      {/* Controls share the mark’s hover area without moving its drag handle. */}
      <div className="folder__mark" style={{ left: mark - FOLDER_CONTROLS - grown, height: hold }}>
        <button
          type="button"
          className="folder__action nopan"
          aria-label={t("folder.minimize")}
          title={t("folder.minimize")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            minimizeFolder(root);
          }}
        >
          <Frame>
            <path d="M5 12 H19" />
          </Frame>
        </button>
        <button
          type="button"
          className="folder__action folder__action--remove nopan"
          aria-label={t("folder.remove")}
          title={t("folder.remove")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            closeFolder(root);
          }}
        >
          <Frame>
            <path d="M4 7 H20 M9 7 V4 H15 V7 M6 7 L7 20 H17 L18 7 M10 10 V17 M14 10 V17" />
          </Frame>
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
