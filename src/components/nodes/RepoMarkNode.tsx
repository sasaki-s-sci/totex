import type { NodeProps } from "@xyflow/react";

import type { RepoMarkFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/**
 * A repository folded into one mark, on its folder's row.
 *
 * The name, then a ring: the same order a band is read in, and the ring on the
 * right because that is the side the lines arrive from. Everything working in
 * any of its worktrees ends on that ring, so a folder of a dozen repositories
 * still says which of them somebody is in without a single history being drawn.
 *
 * Pressing it opens that repository out into a band underneath the row. The
 * whole mark is the button — a ring alone is a small thing to aim at, and the
 * name beside it is what somebody is aiming for anyway.
 */
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
