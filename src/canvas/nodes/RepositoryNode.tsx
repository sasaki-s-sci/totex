import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { COMMIT_STEP, type RepositoryFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { CloseMark, GitMark, MARK_BUTTON } from "../../marks";
import { changeClass, useChanges } from "../changes";
import { useGraphActions } from "../graphActions";
import { HistoryLength } from "./HistoryLength";

// A name's font size, so git's figure stands as tall as the letters of every name on the canvas.
const NAME_FONT = 13;

export function RepositoryNode({ data }: NodeProps<RepositoryFlowNode>) {
  const { t } = useTranslation();
  const { repository, label, name } = data;
  const { closeRepository, foldRepository } = useGraphActions();
  // What its worktrees come to, as the column colours a repository's name.
  const change = useChanges().repositories.get(repository.id);

  return (
    <div className="band">
      <div
        className="band__name"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
        {/* Two lines: the rail and what closes above, then the mark against the fold on the trunk. */}
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
          {/* What the repository is moved by: it stands on its own, with no row above to take hold of. */}
          <div className={`${GRIP} band__grip nopan`} title={t("folder.move")}>
            <GitMark on size={NAME_FONT} />
          </div>
        </div>
      </div>

      {/* On top of the terminal column, where a folder's name and a folded repository's stand. */}
      <div
        className="row__name row__name--above"
        style={{ left: name.x, top: name.y, width: name.width, height: name.height }}
      >
        <button
          type="button"
          className={`folder__name nopan${changeClass(change)}`}
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
      </div>
    </div>
  );
}
