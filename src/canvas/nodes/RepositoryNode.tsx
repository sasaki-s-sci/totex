import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { COMMIT_STEP, type RepositoryFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { CloseMark, GitMark, MARK_BUTTON } from "../../marks";
import { useGraphActions } from "../graphActions";
import { HistoryLength } from "./HistoryLength";

// The name's own font size, so git's figure stands as tall as the letters beside it.
const NAME_FONT = 13;

export function RepositoryNode({ data }: NodeProps<RepositoryFlowNode>) {
  const { t } = useTranslation();
  const { repository, label } = data;
  const { closeRepository, foldRepository } = useGraphActions();

  return (
    <div className="band">
      <div
        className="band__name"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
        {/* Two lines: the rail and what closes above, then the name with the mark against the fold on the trunk. */}
        <div
          className="band__heading"
          style={
            {
              "--square": `${MARK_BUTTON}px`,
              "--line": `${COMMIT_STEP.y}px`,
            } as CSSProperties
          }
        >
          <HistoryLength repository={repository} />
          <button
            type="button"
            className="band__close nopan"
            aria-label={t("repository.close")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              closeRepository(repository);
            }}
          >
            <CloseMark />
          </button>
          <button
            type="button"
            className="folder__name nopan"
            aria-label={repository.name}
            aria-expanded
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              foldRepository(repository.id);
            }}
          >
            <Typography variant="body2" sx={{ minWidth: 0, fontWeight: "normal" }} noWrap>
              {repository.name}
            </Typography>
          </button>
          {/* What the repository is moved by: it stands on its own, with no row above to take hold of. */}
          <div className={`${GRIP} band__grip nopan`} title={t("folder.move")}>
            <GitMark on size={NAME_FONT} />
          </div>
        </div>
      </div>
    </div>
  );
}
