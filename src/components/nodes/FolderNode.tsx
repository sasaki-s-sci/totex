import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { FolderFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { useGraphActions } from "../graphActions";
import { CliMark, FolderMark } from "../marks";

/**
 * A folder on the graph, drawn as the one line that heads its repositories.
 *
 * Three things on a row, and each of them is the folder said a different way.
 * The name is the control: pressing it opens every repository in the folder out
 * into a band, and pressing it again folds the lot back into a mark apiece.
 * Nothing says which of the two the next press will do — the column under it
 * does, by what is standing in it.
 *
 * The mark that leads the row is the folder itself. Every line down to a
 * repository leaves it, so it is where the group is held together, and it is
 * what the group is carried by: the hand takes the folder here and the whole
 * column comes with it. It is deliberately not a button — a mark that both
 * moved the group and did something when it was pressed would do the something
 * every time a drag came to nothing.
 *
 * The button at the end opens a terminal in the folder itself, which is where
 * work that spans the repositories is done. It is the same button a branch row
 * ends with, and it stands in the same place: past everything the row holds.
 */
export function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const { t } = useTranslation();
  const { root, name, label, open, mark, tools } = data;
  const { openWork, toggleFolder } = useGraphActions();

  return (
    <div className="band folder">
      {/* The folder itself, and the handle the column is moved by. At the head
          of the row, which is the order the folder column reads in and is what
          gives the lines down to the repositories the room to fan out. `nopan`
          so that taking hold of it is not also a drag across the canvas. */}
      <div className={`${GRIP} nopan`} style={{ left: mark }} title={t("folder.move")}>
        <FolderMark on={open} size={15} />
      </div>

      <div
        className="band__name folder__label"
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
          <CliMark size={11} />
        </button>
      </div>
    </div>
  );
}
