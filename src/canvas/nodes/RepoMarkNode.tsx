import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { RepoMarkFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { CLI_GLYPH, CliMark } from "../../marks";
import { useGraphActions } from "../graphActions";

export function RepoMarkNode({ data }: NodeProps<RepoMarkFlowNode>) {
  const { t } = useTranslation();
  const { repository, work } = data;
  const { openRepository, openWork } = useGraphActions();

  return (
    <div className="band folder repo-mark">
      <div className="row__name">
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
        aria-label={t("cli.open")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openWork({ repository, ...work });
        }}
      >
        <CliMark size={CLI_GLYPH} />
      </button>

      {/* The ring is the drag handle, as a folder's mark is; the name over it is the toggle. */}
      <span className={`${GRIP} nopan`} title={t("folder.move")}>
        <span className="repo-mark__ring" />
      </span>
    </div>
  );
}
