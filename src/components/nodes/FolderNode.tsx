import TerminalIcon from "@mui/icons-material/Terminal";
import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { FolderFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/**
 * A folder on the graph, drawn as the one line that heads its repositories.
 *
 * The name is the whole of the control: pressing it opens every repository in
 * the folder out into a band, and pressing it again folds the lot back into the
 * marks beside it. Nothing says which of the two the next press will do — the
 * row does, by whether there are marks on it.
 *
 * The button at the end opens a terminal in the folder itself, which is where
 * work that spans the repositories is done. It is the same button a branch row
 * ends with, and it stands in the same place: past everything the row holds.
 */
export function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const { t } = useTranslation();
  const { root, name, label, open, tools } = data;
  const { openWork, toggleFolder } = useGraphActions();

  return (
    <div className="band folder">
      <div
        className="band__name"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
        {/* A folder is the only name on this canvas that is also a button. It
            is set in the same cell a repository's name takes, so the two read
            as one column of names down the left of everything. */}
        <button
          type="button"
          className="folder__name nopan"
          aria-label={name}
          aria-expanded={open}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggleFolder(root);
          }}
        >
          <Typography variant="body2" sx={{ minWidth: 0, fontWeight: "normal" }} noWrap>
            {name}
          </Typography>
        </button>
      </div>

      <div className="folder__tools nopan" style={{ left: tools }}>
        <button
          type="button"
          className="tools__button"
          aria-label={t("folder.shell")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openWork({ repository: null, branch: name, cwd: root });
          }}
        >
          <TerminalIcon sx={{ fontSize: 11 }} />
        </button>
      </div>
    </div>
  );
}
