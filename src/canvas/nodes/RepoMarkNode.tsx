import type { NodeProps } from "@xyflow/react";

import { useTranslation } from "react-i18next";
import type { RepoMarkFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { useGraphActions } from "../graphActions";

export function RepoMarkNode({ data }: NodeProps<RepoMarkFlowNode>) {
  const { t } = useTranslation();
  const { repository } = data;
  const { openRepository } = useGraphActions();

  return (
    <div className="cell repo-mark">
      {/* The ring is the drag handle, as a folder's mark is; the name beside it is the toggle. */}
      <span className={`${GRIP} repo-mark__grip nopan`} title={t("folder.move")}>
        <span className="repo-mark__ring" />
      </span>
      <button
        type="button"
        className="mark nopan repo-mark__row"
        aria-label={repository.name}
        aria-expanded={false}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openRepository(repository.id);
        }}
      >
        <span className="repo-mark__name">{repository.name}</span>
      </button>
    </div>
  );
}
