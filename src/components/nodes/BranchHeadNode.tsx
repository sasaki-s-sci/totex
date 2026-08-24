import type { NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPull } from "../../hooks/useFetchPull";
import { type BranchHeadFlowNode, HEAD_SIZE, PAIR_RING } from "../../lib/graph";
import { dirtyCount, type WorktreeStatus } from "../../lib/workspace";
import { useGraphActions } from "../graphActions";
import { branchMark, useGraphMark } from "../graphMarks";
import { CliMark } from "../marks";
import { useWorktreeStatuses, type WorktreeStatuses } from "../worktreeStatus";

/**
 * Where a branch is, and the state of the codebase standing there.
 *
 * Drawn as a ring rather than as a filled dot: a commit is history and has its
 * contents settled, and this is the working copy at the tip — everything about
 * it is still open. A branch cut and never committed to still shows up here, as
 * an empty one.
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
 * On the rim rather than as a fill, because a filled ring reads as a commit —
 * the history is drawn in solid marks — and because the mark is sixteen pixels
 * across: an interior split three ways is three wedges too small to tell apart,
 * while a rim split three ways is one line whose colour changes as the eye runs
 * round it. Nothing about the ring moves when the share does; only its colour.
 * A refusal and a wait take the rim back for as long as they last: both are
 * about to change what is uncommitted, and both are over sooner than it is.
 *
 * The plain ring is the button's own border. Everything cut into that line —
 * the shares, the dashes — is drawn as a stroked circle instead, on the line
 * the border was on; see `rimOf`.
 *
 * It sits in the one column every branch stands in, past the whole of the
 * history, and the line back to the commit it points at carries the branch's
 * name — so the head itself needs no label, and reading the column downwards
 * reads what the repository has.
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
      {/* The other end of this branch, standing on the same commit as this one:
          a ring outside the head's own rather than a head of its own, because
          one commit is one place to stand. It is drawn before the head so the
          head is drawn over it — what is left of this to take hold of is the
          gap between the two, which is the whole of what a pull needs. */}
      {together && (
        <button
          type="button"
          ref={pull.handle}
          className={`mark mark--centred nopan head__pair${live ? " is-asking" : ""}`}
          style={{ width: PAIR_RING, height: PAIR_RING }}
          aria-label={asking ?? name}
          onPointerDown={pull.onPointerDown}
          onClick={pull.onClick}
        />
      )}

      {/* Whatever follows the branch along its row runs out to the right. */}
      <button
        type="button"
        // The head of a branch that is somewhere else is the pull itself: there
        // is nothing here to drag onto another branch, because git merges what
        // is checked out and a remote-tracking ref never is.
        ref={kind === "remote" ? pull.handle : undefined}
        className={`mark mark--centred nopan head__ring${state ? ` ${state}` : ""}${doing}${
          kind === "remote" && live ? " is-asking" : ""
        }`}
        style={{ width: HEAD_SIZE, height: HEAD_SIZE }}
        aria-label={
          kind === "remote" && asking
            ? asking
            : t("branch.head", { name, context: hasRemote ? "remote" : "" })
        }
        onPointerDown={
          kind === "remote" ? pull.onPointerDown : (event) => dragBranch(repository, name, event)
        }
        onClick={
          kind === "remote"
            ? pull.onClick
            : (event) => {
                event.stopPropagation();
                pickBranch({
                  repository,
                  branch: name,
                  kind,
                  cwd,
                  at: { x: event.clientX, y: event.clientY },
                });
              }
        }
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

/** The line the ring is drawn on: the width of the button's border, and the
    circle that width is laid along. Both are in the mark's own units, which is
    what the ink's `viewBox` is written in. */
const RING_WIDTH = 1;
const CENTRE = HEAD_SIZE / 2;
const RADIUS = (HEAD_SIZE - RING_WIDTH) / 2;
/** Half a pixel of the circle, as a share of the way round it: what one arc
    has to reach back to cover the join with the one before it. */
const SEAM = 0.5 / (2 * Math.PI * RADIUS);

/**
 * What the rim is made of: the three things that can have become of a file,
 * each holding the share of the circle it holds of the work.
 *
 * Green for what has arrived, orange for what has been rewritten, red for what
 * has gone — the scheme's `added`, `changed` and `removed`, which are the three
 * colours this window already answers in — laid down in that order from the top
 * and read clockwise, so the rim runs from what the branch is making round to
 * what it is throwing away. A branch that is only
 * adding is a green ring at any size, and one that is mostly deleting cannot be
 * mistaken for it.
 *
 * Counted in files rather than in lines: a file is what the eye is going to go
 * looking for afterwards, and a one-line fix to a config and a rewritten module
 * are one file each here rather than the second drowning the first.
 *
 * Drawn as arcs of one circle. It was a conic gradient cut to the width of the
 * ring by a mask, and a mask is a threshold: a pixel is either in it or it is
 * not, so the inside of the rim had no half-covered pixels along it and came
 * out as a staircase. A stroked arc is antialiased like any other path, and
 * sits on the same line the border it replaces was on.
 *
 * Each arc reaches half a pixel back into the one before it, and they are drawn
 * from the last round to the first — so every join is one arc's soft edge lying
 * on the next one's colour, rather than two soft edges meeting over the canvas
 * with a pale pixel of it left between them.
 */
function rimOf(status: WorktreeStatus | undefined): ReactNode {
  if (!status) return null;

  const total = dirtyCount(status);
  if (total === 0) return null;

  const arcs: { colour: string; from: number; to: number }[] = [];
  let from = 0;
  for (const [count, colour] of [
    [status.added, "var(--mui-palette-success-main)"],
    [status.modified, "var(--mui-palette-warning-main)"],
    [status.deleted, "var(--mui-palette-error-main)"],
  ] as const) {
    if (count === 0) continue;
    from += count / total;
    arcs.push({ colour, from: from - count / total, to: from });
  }
  // The shares are counted off one after another, so the last one ends where
  // the first began however the divisions rounded.
  const last = arcs[arcs.length - 1];
  if (last) last.to = 1;

  return arcs.map(({ colour, from: at, to }) => arc(colour, at, to)).reverse();
}

/**
 * A branch with no worktree, dotted like every offer on this canvas that is not
 * there yet.
 *
 * Ten dashes of its own rather than the browser's: `border-style: dashed` draws
 * dashes as long as the border is thick, which around a ring this small comes
 * to four of them with a quarter of the circle missing between each — a ring
 * that reads as broken rather than as one that is not there yet. `pathLength`
 * makes the circle 360 units round, so the dash and the gap between two dashes
 * are written as the degrees they take.
 */
function dashes(): ReactNode {
  return (
    <circle
      cx={CENTRE}
      cy={CENTRE}
      r={RADIUS}
      pathLength={360}
      strokeDasharray="22 14"
      transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
    />
  );
}

/**
 * One share of the rim, from `from` to `to` of the way round, clockwise from
 * the top.
 *
 * `pathLength` makes the circle one unit round, so a share is the dash and what
 * is left of the circle is the gap. The dash starts half a pixel early: what is
 * under that half pixel is the arc drawn before this one, and covering it is
 * what keeps the canvas from showing between two colours.
 */
function arc(colour: string, from: number, to: number): ReactNode {
  const dash = Math.min(to - from + SEAM, 1);
  return (
    <circle
      key={colour}
      cx={CENTRE}
      cy={CENTRE}
      r={RADIUS}
      stroke={colour}
      pathLength={1}
      // A share that is the whole circle has nothing to cut into it.
      strokeDasharray={dash < 1 ? `${dash} ${1 - dash}` : undefined}
      strokeDashoffset={dash < 1 ? SEAM - from : undefined}
      transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
    />
  );
}
