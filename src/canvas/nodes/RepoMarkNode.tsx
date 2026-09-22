import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { RepoMarkFlowNode } from "../../lib/graph";
import { FOLDER_MARK_X, GRIP, ROW_NAME } from "../../lib/graph/folders";
import { CLI_GLYPH, CliMark } from "../../marks";
import { useGraphActions } from "../graphActions";

export function RepoMarkNode({ data }: NodeProps<RepoMarkFlowNode>) {
  const { t } = useTranslation();
  const { repository, work } = data;
  const { openRepository, openWork } = useGraphActions();

  return (
    <div className="band folder repo-mark">
      {/* Ahead of the ring on its line, where a band's name stands ahead of its mark. */}
      <div className="row__name" style={{ left: ROW_NAME.x, width: ROW_NAME.width }}>
        <button
          type="button"
          className="folder__name nopan"
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
        <CliMark size={CLI_GLYPH} />
      </button>

      {/* The ring is the drag handle, as a folder's mark is; the name beside it is the toggle. */}
      <span className={`${GRIP} nopan`} style={{ left: FOLDER_MARK_X }} title={t("folder.move")}>
        <span className="repo-mark__ring" />
      </span>
    </div>
  );
}
