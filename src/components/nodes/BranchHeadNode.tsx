import CloudIcon from "@mui/icons-material/CloudOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type BranchHeadFlowNode, HEAD_SIZE } from "../../lib/graph";
import { dirtyCount, type WorktreeStatus } from "../../lib/workspace";
import { useGraphActions } from "../graphActions";
import { branchMark, useGraphMark } from "../graphMarks";
import { useWorktreeStatuses } from "../worktreeStatus";

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
 * leave level with the ring, what is uncommitted is on the rim, and the cloud
 * that says a branch is also on a remote stands on the left shoulder. Above
 * rather than off a corner, so the button is on the branch's own vertical and a
 * column of heads carries a column of these. A remote branch has no button —
 * it is somewhere else, and nothing can be opened in it.
 */
export function BranchHeadNode({ data }: NodeProps<BranchHeadFlowNode>) {
  const { t } = useTranslation();
  const { name, kind, hasRemote, cwd, repository, provisional } = data;
  const { openWork, pickBranch, dragBranch } = useGraphActions();
  const status = useWorktreeStatuses().get(cwd ?? "");

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
      {hasRemote && <CloudIcon className="head__remote" aria-hidden sx={{ fontSize: 10 }} />}
      {/* Whatever follows the branch along its row runs out to the right. */}
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
          <TerminalIcon sx={{ fontSize: 11 }} />
        </button>
      )}
    </div>
  );
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
 * Green for what has arrived, amber for what has been rewritten, red for what
 * has gone — the three colours this window already answers in — laid down in
 * that order from the top and read clockwise, so the rim runs from what the
 * branch is making round to what it is throwing away. A branch that is only
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
