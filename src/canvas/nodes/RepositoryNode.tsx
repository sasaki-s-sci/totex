import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { RepositoryFlowNode } from "../../lib/graph";
import { CloseMark, MARK_BUTTON } from "../../marks";
import { useGraphActions } from "../graphActions";

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
        <div
          className="band__heading"
          style={
            {
              minWidth: label.column + MARK_BUTTON,
              "--square": `${MARK_BUTTON}px`,
            } as CSSProperties
          }
        >
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
        </div>
      </div>
    </div>
  );
}
