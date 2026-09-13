import type { NodeProps } from "@xyflow/react";

import type { RepoMarkFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

export function RepoMarkNode({ data }: NodeProps<RepoMarkFlowNode>) {
  const { repository } = data;
  const { openRepository } = useGraphActions();

  return (
    <div className="cell repo-mark">
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
        <span className="repo-mark__ring" />
      </button>
    </div>
  );
}
