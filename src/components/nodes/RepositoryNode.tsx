import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { RepositoryFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";
import { CloseMark, MarkButton } from "../marks";

export function RepositoryNode({ data }: NodeProps<RepositoryFlowNode>) {
  const { t } = useTranslation();
  const { repository, label } = data;
  const { closeRepository, foldRepository } = useGraphActions();

  return (
    <div className="band">
      {/* The name and the one mark that answers for the repository itself, in
          the cell before the first commit and on the same line — one more step
          of the same grid, so it reads as where the repository starts rather
          than as a caption over it. */}
      <div
        className="band__name"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
        {/* Ahead of the name rather than after it: the name is set against the
            history it labels, and a mark between the two would be read on the
            way into it. The same mark and the same word as the one that closes
            a folder in the column, because it is the same move — this takes the
            repository off the canvas and nothing else. */}
        <span className="band__close nopan">
          <MarkButton
            label={t("repository.close")}
            faint
            onClick={() => closeRepository(repository)}
          >
            <CloseMark />
          </MarkButton>
        </span>
        {/* The name folds the repository back into the mark it came out of, on
            its folder's row. The same press in the same place as the folder's
            own name, one level down: a name on this canvas is what opens and
            shuts the thing it names. */}
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
      </div>
    </div>
  );
}
