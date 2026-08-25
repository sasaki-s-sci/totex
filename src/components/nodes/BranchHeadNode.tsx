import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useFetchPull } from "../../hooks/useFetchPull";
import { type BranchHeadFlowNode, DOT_SIZE, HEAD_SIZE, PAIR_RING } from "../../lib/graph";
import { dirtyCount } from "../../lib/workspace";
import { useGraphActions } from "../graphActions";
import { branchMark, useGraphMark } from "../graphMarks";
import { CliMark } from "../marks";
import { useWorktreeStatuses, type WorktreeStatuses } from "../worktreeStatus";
import { dashes, rimOf } from "./branchRim";

/**
 * A branch-column commit and the states layered over it.
 *
 * The small solid centre is the commit the branch points at. A workspace is the
 * middle hollow ring over it, dashed while it has not been created; origin is
 * the largest dashed ring. The radii are vocabulary: when local and remote have
 * parted, each still carries its commit at the centre and only the layers that
 * exist at that end.
 *
 * The ring stays hollow — the canvas shows through it either way — and what is
 * uncommitted is drawn on its rim instead: the files that have arrived, the
 * files that have been rewritten and the files that have gone, each taking the
 * share of the circle it has of the work. A copy with nothing in it that its
 * commit does not already have keeps the plain ring, so a branch that has been
 * touched is told from one that has not by whether the rim has colour in it at
 * all, and a branch mid-rewrite is told from one that is only adding without
 * anything having to be counted. A branch with no worktree at all is dotted,
 * like every other offer here that is not there yet: the branch exists, the
 * codebase for it does not, and opening it makes one.
 *
 * On the rim rather than as a fill, because the solid centre belongs to the
 * commit underneath it, and because the workspace ring is still small: an
 * interior split three ways is three wedges too small to tell apart,
 * while a rim split three ways is one line whose colour changes as the eye runs
 * round it. Nothing about the ring moves when the share does; only its colour.
 * A refusal and a wait take the rim back for as long as they last: both are
 * about to change what is uncommitted, and both are over sooner than it is.
 *
 * The plain workspace ring is the button's own border. Everything cut into
 * that line — the shares, the dashes — is drawn as a stroked circle instead,
 * on the line the border was on; see `rimOf`.
 *
 * It sits in the one column every branch stands in, past the whole of the
 * history. The line back to the history copy of this same commit carries the
 * branch's name, so the node itself needs no label and reading the column
 * downwards reads what the repository has.
 *
 * It is also the handle for the branch: click it for what can be done with its
 * working directory, or drag it onto another head to merge into that one.
 *
 * What can be done *in* the branch is the one button standing over it: a
 * terminal opened here, which is the same button a folder's row ends with.
 * Pressing it puts a mark in the column past the branch — see `CliNode` — and
 * that mark is joined back to this ring by a line. The offer used to be a
 * dashed mark of its own standing in that column with a dashed line out to it,
 * which drew the canvas a terminal that did not exist: the column now holds
 * what is running and nothing else, and what could be running is on the branch
 * itself, where the rest of what can be done to a branch already is.
 *
 * Straight above the ring, because everything else round a head is taken: the
 * line from the history arrives on the left, the lines out to the terminals
 * leave level with the ring, and what is uncommitted is on the rim. Above
 * rather than off a corner, so the button is on the branch's own vertical and a
 * column of heads carries a column of these. A remote branch has no button —
 * it is somewhere else, and nothing can be opened in it.
 *
 * That a branch is also on a remote used to go undrawn. It had stood as a cloud
 * on the ring's left shoulder, and it was the one mark here that said something
 * the window could do nothing about — every other thing on a head is a state
 * this window changes or a button it answers. It is drawn again now, and as a
 * button: the two ends of one branch share a row, and where they stand on one
 * commit the remote end is the ring round this one. Pull that ring outwards and
 * the remote is asked for whatever it has that this machine has not.
 *
 * Which end carries the pull is only ever a question of which end is there. A
 * branch whose ends have parted has a head each — this one and, hanging under
 * it, the remote's — and the pull is on that one, where the asking belongs. A
 * branch at rest has one head, so this is it.
 */
export function BranchHeadNode({ data }: NodeProps<BranchHeadFlowNode>) {
  const { t } = useTranslation();
  const { name, kind, hasRemote, together, fetch, cwd, repository, provisional } = data;
  const { openWork, pickBranch, dragBranch, fetchBranch } = useGraphActions();
  const statuses = useWorktreeStatuses();
  const status = statuses.get(cwd ?? "");

  // A fetch is offered over a codebase at rest, and the codebase is the local
  // end's whichever end is being asked. Nothing about the fetch itself needs
  // it — refs and objects are all it writes — but reaching for what a remote
  // has is something done between pieces of work rather than inside one.
  const live = fetch !== null && atRest(statuses, fetch.work);
  // What a pull on the ring carrying it would ask for, said for anything
  // reading the window aloud — where the ring itself cannot be seen at all.
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
  // What the window is doing to this branch, or could not do to it. Neither is
  // history, and both are drawn on the ring rather than said anywhere.
  const key = branchMark(repository.id, name);
  const mark = useGraphMark(key);
  const doing = mark === "busy" ? " is-busy" : mark === "failed" ? " is-failed" : "";

  // What the ring's line is made of, where it is not the plain border. The
  // shares are this worktree's own and move with every save, which is why they
  // are drawn here rather than being a state the stylesheet could name; the
  // dashes are here to be on the same circle as the shares.
  const ink = !cwd ? dashes() : dirty && !doing ? rimOf(status) : null;

  return (
    <div
      className={`cell head${provisional ? " is-provisional" : ""}`}
      data-repository={repository.id}
      data-branch={name}
    >
      {/* Origin is the largest layer. When it has moved away this entire node
          moves with it and still keeps the commit at its centre; when it is in
          sync with a local branch, the local node carries all three layers. */}
      {(kind === "remote" || together) && (
        <button
          type="button"
          ref={pull.handle}
          className={`mark mark--centred nopan head__origin${live ? " is-asking" : ""}`}
          style={{ width: PAIR_RING, height: PAIR_RING }}
          aria-label={asking ?? name}
          onPointerDown={pull.onPointerDown}
          onClick={pull.onClick}
        />
      )}

      {/* Every branch-column node is a commit first. Workspace and origin are
          states layered over this solid centre, not substitute endpoints. */}
      <span
        className="mark mark--centred head__commit"
        style={{ width: DOT_SIZE, height: DOT_SIZE }}
        aria-hidden="true"
      />

      {/* A local branch or detached worktree contributes the middle workspace
          ring. A remote-only ref has no workspace at that commit, so it leaves
          the middle radius empty and shows only commit + origin. */}
      {kind !== "remote" && (
        <button
          type="button"
          className={`mark mark--centred nopan head__ring${state ? ` ${state}` : ""}${doing}`}
          style={{ width: HEAD_SIZE, height: HEAD_SIZE }}
          aria-label={t("branch.head", { name, context: hasRemote ? "remote" : "" })}
          onPointerDown={(event) => dragBranch(repository, name, event)}
          onClick={(event) => {
            event.stopPropagation();
            pickBranch({
              repository,
              branch: name,
              kind,
              cwd,
              // Handed over rather than looked up again on the other side:
              // the ring above was drawn from it, so the menu and the mark
              // that opened it are answering about the same moment.
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
      )}

      {/* The offer of a terminal in this branch, standing over its ring. Faint
          until the pointer is on it, like every other button that stands on the
          canvas rather than in a row of its own — and gone altogether when the
          canvas is zoomed out past what a pointer can be aimed at; see
          `DETAIL_ZOOM`. */}
      {kind !== "remote" && (
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
      )}
    </div>
  );
}

/**
 * Whether the codebase a fetch belongs to has nothing uncommitted in it.
 *
 * A branch with no worktree has nothing that could be in the middle of
 * anything, and neither has one nobody has read a status for yet — that reading
 * is on a clock and arrives a moment later, and a ring that started out refusing
 * and then agreed would read as the window changing its mind.
 */
function atRest(statuses: WorktreeStatuses, work: string | null): boolean {
  if (work === null) return true;
  const status = statuses.get(work);
  return status === undefined || dirtyCount(status) === 0;
}
