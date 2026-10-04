import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { RepoMarkFlowNode } from "../../lib/graph";
import { FOLDER_MARK_X, GRIP } from "../../lib/graph/folders";
import { CliMark } from "../../marks";
import { changeClass, useChanges } from "../changes";
import { useGraphActions } from "../graphActions";
import { useMarkSizes } from "../markSizes";

export function RepoMarkNode({ data }: NodeProps<RepoMarkFlowNode>) {
  const { t } = useTranslation();
  const marks = useMarkSizes();
  const { repository, work, label } = data;
  const { openRepository, openWork } = useGraphActions();
  // Folded, the ring stands for every branch: it wears what all of them come to.
  const change = useChanges().repositories.get(repository.id);

  return (
    <div className="band folder repo-mark">
      {/* On top of the terminals beside the ring, as a folder's name stands on its own. */}
      <div
        className="row__name row__name--above"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
        <button
          type="button"
          className={`folder__name nopan${changeClass(change)}`}
          aria-label={repository.name}
          aria-expanded={false}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openRepository(repository.id);
          }}
        >
          <Typography variant="body2" sx={{ minWidth: 0, fontWeight: "normal" }} noWrap>
            {repository.name}
          </Typography>
        </button>
      </div>

      <button
        type="button"
        className="row__cli tools__button nopan"
        style={{ left: FOLDER_MARK_X }}
        aria-label={t("cli.open")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openWork({ repository, ...work });
        }}
      >
        <CliMark size={marks.cli} />
      </button>

      {/* The ring is the drag handle, as a folder's mark is; the name beside it is the toggle. */}
      <span className={`${GRIP} nopan`} style={{ left: FOLDER_MARK_X }} title={t("folder.move")}>
        <span className={`repo-mark__ring${changeClass(change)}`} />
      </span>
    </div>
  );
}
