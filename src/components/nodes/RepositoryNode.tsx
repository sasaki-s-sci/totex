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
      {/* The name and the one mark that answers for the repository itself, on
          the line above the mark the band opens with — the first commit drawn,
          or the fold where there is history behind it — and set at the left of
          that mark's own column, so the eye runs down from the name into the
          history rather than across into it. The same place a folder's name
          stands over the mark that is the folder, one level up the column. */}
      <div
        className="band__name"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
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
        {/* After the name rather than ahead of it: the name is set over the
            history it labels now, so nothing is read on the way into it, and a
            mark before the name would stand where the folder's line arrives.
            The same mark and the same word as the one that closes a folder in
            the column, because it is the same move — this takes the repository
            off the canvas and nothing else. */}
        <span className="band__close nopan">
          <MarkButton
            label={t("repository.close")}
            faint
            onClick={() => closeRepository(repository)}
          >
            <CloseMark />
          </MarkButton>
        </span>
      </div>
    </div>
  );
}
