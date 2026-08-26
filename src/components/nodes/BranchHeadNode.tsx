import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useFetchPull } from "../../hooks/useFetchPull";
import { type BranchHeadFlowNode, HEAD_SIZE, REMOTE_HEAD_SIZE } from "../../lib/graph";
import { dirtyCount } from "../../lib/workspace";
import { useGraphActions } from "../graphActions";
import { branchMark, useGraphMark } from "../graphMarks";
import { CliMark } from "../marks";
import { useWorktreeStatuses, type WorktreeStatuses } from "../worktreeStatus";
import { dashes, rimOf } from "./branchRim";

/**
 * One ref at the end of its edge from history.
 *
 * This is deliberately not another commit: the real commit remains in the
 * history grid. Local/workspace refs use a compact solid ring, while remote
 * refs use a clear dashed ring. Synchronized refs are still separate React Flow
 * nodes, but the remote's visible ring collapses to the local size at their
 * shared centre so the result reads as one simple node.
 */
export function BranchHeadNode({ data }: NodeProps<BranchHeadFlowNode>) {
  const { t } = useTranslation();
  const { name, kind, together, fetch, cwd, repository, provisional } = data;
  const { openWork, browseWorktree, pickBranch, dragBranch, fetchBranch } = useGraphActions();
  const statuses = useWorktreeStatuses();
  const status = statuses.get(cwd ?? "");

  const live = fetch !== null && atRest(statuses, fetch.work);
  const asking = fetch && t("branch.fetch", { remote: fetch.remote, branch: fetch.branch });
  const pull = useFetchPull({
    live,
    onFetch: () => {
      if (fetch) fetchBranch({ repository, branch: name, fetch });
    },
    onOpen: (event) =>
      pickBranch({
        repository,
        branch: name,
        kind,
        cwd,
        at: { x: event.clientX, y: event.clientY },
      }),
  });

  const dirty = cwd !== null && status !== undefined && dirtyCount(status) > 0;
  const state = !cwd ? "is-unopened" : dirty ? "is-dirty" : null;
  const key = branchMark(repository.id, name);
  const mark = useGraphMark(key);
  const doing = mark === "busy" ? " is-busy" : mark === "failed" ? " is-failed" : "";
  const ink = !cwd ? dashes() : dirty && !doing ? rimOf(status) : null;

  return (
    <div
      className={`cell head${provisional ? " is-provisional" : ""}`}
      data-repository={repository.id}
      data-branch={name}
    >
      {kind === "remote" ? (
        <button
          type="button"
          ref={pull.handle}
          className={`mark mark--centred nopan head__origin${together ? " is-together" : ""}${live ? " is-asking" : ""}`}
          style={{ width: REMOTE_HEAD_SIZE, height: REMOTE_HEAD_SIZE }}
          aria-label={asking ?? name}
          onPointerDown={pull.onPointerDown}
          onClick={pull.onClick}
        />
      ) : (
        <>
          <button
            type="button"
            className={`mark mark--centred nopan head__ring${state ? ` ${state}` : ""}${doing}`}
            style={{ width: HEAD_SIZE, height: HEAD_SIZE }}
            aria-label={t("branch.browse", { name })}
            onPointerDown={(event) => dragBranch(repository, name, event)}
            onClick={(event) => {
              event.stopPropagation();
              browseWorktree({ repository, branch: name, cwd });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              pickBranch({
                repository,
                branch: name,
                kind,
                cwd,
                status,
                at: { x: event.clientX, y: event.clientY },
              });
            }}
          >
            {ink && (
              <svg
                className="head__ring__ink"
                viewBox={`0 0 ${HEAD_SIZE} ${HEAD_SIZE}`}
                aria-hidden="true"
              >
                {ink}
              </svg>
            )}
          </button>

          <button
            type="button"
            className="head__cli tools__button nopan"
            aria-label={t("cli.open")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openWork({ repository, branch: name, cwd });
            }}
          >
            <CliMark size={11} />
          </button>
        </>
      )}
    </div>
  );
}

function atRest(statuses: WorktreeStatuses, work: string | null): boolean {
  if (work === null) return true;
  const status = statuses.get(work);
  return status === undefined || dirtyCount(status) === 0;
}
