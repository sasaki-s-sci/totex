import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { FolderFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { CLI_GLYPH, CliMark, FolderMark } from "../../marks";
import { changeClass, useChanges } from "../changes";
import { useGraphActions } from "../graphActions";

export function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const { t } = useTranslation();
  const { root, name, label, open, mark } = data;
  const { openWork } = useGraphActions();
  // The top of the climb: what every repository under the folder comes to.
  const change = useChanges().folders.get(root);

  return (
    <div className="band folder">
      {/* Ahead of the mark on its line. Only a name: a folder holds nothing to fold or take off, and the sidebar is where it leaves. */}
      <div className="row__name" style={{ left: label.x, width: label.width }}>
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
        style={{ left: mark }}
        aria-label={t("folder.shell")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openWork({ repository: null, branch: name, cwd: root });
        }}
      >
        <CliMark size={CLI_GLYPH} />
      </button>

      {/* The mark is the drag handle and deliberately not a button: a button would fire on every drag that came to nothing. */}
      <div className={`${GRIP} nopan`} style={{ left: mark }} title={t("folder.move")}>
        <FolderMark on={open} size={15} />
      </div>
    </div>
  );
}
