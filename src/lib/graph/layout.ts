import type { Repository } from "../../types/git";
import { placeBranches } from "./branches";
import { type Point, shortOf } from "./geometry";
import { commitNodeId, defaultShown, placeHistory } from "./history";
import { Lines, labelOf } from "./lines";
import {
  type BandLines,
  type BranchHeadFlowNode,
  CELL_STYLE,
  CHIP_STEP,
  CLI_STEP,
  COLUMN_WIDTH,
  COMMIT_CELL,
  COMMIT_STEP,
  type CollapseFlowNode,
  type CommitFlowNode,
  LANE_HEIGHT,
  LINE_COLOR,
  MIN_BAND_WIDTH,
  NAME_COLUMN,
  onCell,
  onCommit,
  PAIR_DROP,
  type RepositoryNodeData,
  RING_TRIM,
  rowPitch,
  rowReach,
  SESSION_WIDTH,
  type StrokeStyle,
} from "./model";

/**
 * One repository, laid out: where every commit, branch head and offer goes
 * inside the band that holds them.
 *
 * A band is read left to right in four parts, and each of them answers a
 * different question:
 *
 *   - the repository's name, in the first cell;
 *   - the history, which is the tree of what depends on what, drawn on a grid
 *     of its own — half a cell each way, because dots and lines pack tighter
 *     than words do;
 *   - the branches, every one of them in a single column, in the alphabet's
 *     order from the top with nothing skipped, so that what the repository has
 *     is one thing to read rather than names to be found among the commits;
 *   - what is running in each branch, stacked straight down from that branch's
 *     own row.
 *
 * A branch head therefore does not stand where the branch was cut. It stands
 * where every other branch stands, and the line out of the commit it points at
 * is what says where it is — which is what a branch is: a name on a commit.
 *
 * The two halves are dealt their rows apart and hang from the same line at the
 * top of the band. That is the whole of the arrangement: the history's rows are
 * its lanes, evenly spaced because nothing hangs off them, and the branch
 * column's rows are its names, spaced by what each of them is running.
 *
 * What is actually in each stack is not settled here. Terminals come and go
 * while the layout they hang off does not, so this only says where a stack
 * starts and how far apart its marks are; `build` fills it with whatever
 * happens to be running when the canvas is drawn. How deep each stack is, on
 * the other hand, is the layout's business — a stack pushes the branches under
 * it down to make room for itself, and that is a shape rather than a filling.
 *
 * The band's own position on the canvas is not settled here either — that is
 * its folder's column, in `build` — so everything below is relative to it, and
 * a repository that has not changed can be moved without any of it being
 * redone.
 */

/**
 * One repository, drawn. The commits are positioned inside the band rather than
 * on the canvas, so the column can move the band without touching any of them.
 */
export type PreparedRepository = {
  repository: Repository;
  /**
   * The band's own node data and box, which is also what the column moves.
   *
   * The label inside it is where the repository's name is, which is where the
   * line down from its folder lands: a band is joined to what holds it at its
   * name, the way a folded repository's row is.
   */
  data: RepositoryNodeData;
  style: { width: number; height: number };
  nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode)[];
  /** Every line the band draws, already batched by how it is drawn. */
  lines: BandLines;
  /** Where each branch's terminals stand, in the order the bands were laid out. */
  runs: BranchRun[];
};

/**
 * One branch's stack of terminals: where it starts, and how much room it was
 * given.
 *
 * Held apart from the nodes themselves because which terminals are in it is not
 * history: they come and go while the layout they hang off does not. So the
 * layout says where the stack stands, and `build` puts the marks in it.
 *
 * The marks are packed a `CLI_STEP` at a time — the terminals that are running,
 * in the order they were started — and the stack is centred on `x, y`, which is
 * level with the branch itself. A branch with nothing running in it has no
 * stack at all: what it could be running is the button on its own ring, and the
 * column beside it is empty until that button is pressed. Every mark opens the
 * stack out half a step each way, and `build` works out from `stackReach` where
 * the top of it lands.
 */
export type BranchRun = {
  /** The branch's own node, which is what a terminal working here is joined to. */
  head: string;
  /** The directory the stack is of, or null while the branch is only a name. */
  cwd: string | null;
  /** Band-relative middle of that node, where a line into this branch lands. */
  at: Point;
  /** Band-relative corner of the box a stack of one would stand in: its middle. */
  x: number;
  y: number;
};

/**
 * How many terminals are running in a directory, for every directory running
 * any at all.
 *
 * All of them, because a stack is centred on its branch's own line: the room it
 * asks for is split between the row above and the row below, so spacing two
 * rows is a sum over both of their stacks and a stack of one is not the same
 * shape as a stack of two. That does mean a terminal opening lays its own
 * repository out again — the map is read per repository, so the ones beside it
 * are left alone.
 */
export type Depth = ReadonlyMap<string, number>;

/**
 * Laying a repository out is the expensive half of drawing the graph, and a
 * change touches one repository at a time.
 *
 * Keyed by the repository object, which the delta preserves for everything it
 * did not change — so an untouched repository comes back as the very nodes it
 * was drawn from, and React Flow can see for itself that there is nothing to
 * redraw.
 */
const layouts = new WeakMap<
  Repository,
  { shown: number; deep: string; prepared: PreparedRepository }
>();

export function prepare(
  repository: Repository,
  want: number | undefined,
  deep: Depth,
): PreparedRepository {
  // Settled here rather than inside the layout, so the cache is keyed by the
  // history that was actually drawn: asking for more than there is, or for the
  // default, must not count as a different graph.
  const shown = Math.max(1, Math.min(repository.commits.length, want ?? defaultShown(repository)));
  // What of that map this repository is actually affected by, as one string, so
  // that terminals opening and closing somewhere else on the canvas are not a
  // reason to lay this one out again.
  const key = repository.worktrees.map((worktree) => deep.get(worktree.path) ?? 0).join(",");

  const cached = layouts.get(repository);
  if (cached && cached.shown === shown && cached.deep === key) return cached.prepared;

  const prepared = layout(repository, shown, deep);
  layouts.set(repository, { shown, deep: key, prepared });
  return prepared;
}

/**
 * How far past the end of the history the branches stand.
 *
 * Two whole cells of the row grid, rather than the history's own half-width
 * ones, because this gap is what every branch line has to do its climbing in.
 * A head no longer stands on the row its own commits run along, so the line out
 * to one crosses however many rows the alphabet put between the two — and it
 * carries the branch's name along the last of itself, which wants a stretch
 * that has flattened out and room to be read in. Give it a column and the names
 * on the steepest lines are set at an angle and run into each other; give it
 * two and the whole lot reads as a fan closing into a column of names.
 */
const BRANCH_GAP = COLUMN_WIDTH * 2;

/** Every node and line one repository contributes, relative to its band. */
function layout(repository: Repository, shown: number, deep: Depth): PreparedRepository {
  const history = placeHistory(repository, shown);
  const { refs, rows } = placeBranches(repository, history.placed);

  // How deep each row of the branch column is: what is running there, and
  // nothing else. The offer of a terminal is a button on the branch's own ring
  // now, so a branch with nothing in it asks for no room out here.
  const stacks = new Array<number>(rows).fill(0);
  for (const ref of refs) {
    const cwd = ref.data.cwd;
    if (cwd !== null) stacks[ref.row] = Math.max(stacks[ref.row], deep.get(cwd) ?? 0);
  }

  // Both halves hang from one line: the trunk's own lane and the first branch
  // in the alphabet start level with each other, half a lane down the band. Half
  // a lane, because that is what the repository's name needs under it and what a
  // branch running a stack of terminals reaches up by — whichever is the more.
  const top = Math.max(LANE_HEIGHT / 2, rows > 0 ? rowReach(stacks[0]) : 0);

  /** The line each row of the history is drawn along: evenly spaced. */
  const historyLine = (row: number) => top + row * COMMIT_STEP.y;
  /** And each row of the branch column: as far apart as their stacks need. */
  const branchLine: number[] = [];
  for (let row = 0; row < rows; row++) {
    branchLine.push(row === 0 ? top : branchLine[row - 1] + rowPitch(stacks[row - 1], stacks[row]));
  }

  /** The left edge of a column of the history, the name's own cell cleared. */
  const columnX = (column: number) => NAME_COLUMN * COLUMN_WIDTH + column * COMMIT_STEP.x;
  // Where every branch's own mark stands, which is what everything hanging off
  // one is measured from: the ring itself rather than the edge of its cell, so
  // that the terminals beside a branch read as that branch's own and not as a
  // row of their own.
  const ring = columnX(history.width) + BRANCH_GAP;
  const heads = ring - COLUMN_WIDTH / 2;
  // The terminals stack out past the ring, in a column of their own that no
  // line of the history ever crosses.
  const working = ring + CHIP_STEP;

  // The mark the band opens with, which is what the name is set beside: the
  // fold where there is history behind it, and the oldest commit drawn where
  // there is not. Both stand in the first column of the history.
  const opening = history.hidden > 0 ? 0 : (history.placed.at(-1)?.row ?? 0);
  const nameLine = historyLine(opening);

  const nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode)[] = [];
  const drawn = new Lines();
  const runs: BranchRun[] = [];

  // Where every commit's dot ends up, which is where the lines into and out of
  // it are drawn from. A line runs mark to mark, and a mark is the middle of
  // its cell — so this is the cell's middle and not its corner.
  const dots = history.placed.map((entry, position) => ({
    x: columnX(history.columns[position]) + COMMIT_STEP.x / 2,
    y: historyLine(entry.row),
  }));

  for (const [position, entry] of history.placed.entries()) {
    const node: CommitFlowNode = {
      id: commitNodeId(repository, entry.commit.id),
      type: "commit",
      parentId: repository.id,
      extent: "parent",
      position: {
        x: columnX(history.columns[position]),
        y: historyLine(entry.row) - COMMIT_STEP.y / 2,
      },
      data: {
        commit: entry.commit,
        repository,
        branches: entry.branches,
        worktrees: entry.worktrees,
        boundary: entry.boundary,
        folded: entry.folded,
      },
      style: COMMIT_CELL,
    };
    drawn.mark(dots[position], node);
    nodes.push(node);

    for (const parent of entry.commit.parents) {
      const parentPosition = history.index.get(parent);
      if (parentPosition === undefined) continue;

      // A line that stays in its row is drawn straight — which is what the same
      // curve degenerates to anyway, at a fraction of the work. One that moves
      // between rows takes the S, and that is what makes a fork or a merge
      // readable at a glance.
      const curve = entry.row !== history.placed[parentPosition].row;
      const end = shortOf(dots[position], dots[parentPosition], 0, curve);

      drawn.add(
        {
          id: `${repository.id}${entry.commit.id}->${parent}`,
          from: onCommit(commitNodeId(repository, entry.commit.id)),
          to: onCommit(commitNodeId(repository, parent)),
          curve,
          trim: 0,
          lead: 0,
          stroke: HISTORY_STROKE,
        },
        // Folding here keeps everything from this commit forwards; what the
        // line runs down to, and all the history behind it, goes away.
        {
          keep: position + 1,
          hides: history.placed.length - (position + 1),
          from: dots[position],
          to: end,
          curve,
        },
      );
    }
  }

  // What is folded away, and the way to bring it back. `hidden > 0` means the
  // slice was cut short, so there is always an oldest commit for the dash to
  // run to.
  if (history.hidden > 0) {
    const oldest = history.placed[history.placed.length - 1];

    nodes.push({
      id: `${repository.id}collapse`,
      type: "collapse",
      parentId: repository.id,
      extent: "parent",
      position: { x: columnX(0), y: nameLine - COMMIT_STEP.y / 2 },
      data: { repository, hidden: history.hidden },
      style: COMMIT_CELL,
      draggable: false,
      selectable: false,
      // Deliberately no z of its own: lifting a node above its row would lift
      // it over the lines its neighbours are drawn on.
    });

    // Joined to the oldest commit still shown, so the line reads as history
    // carrying on off the end rather than starting there. A plain line: what
    // can be done about the fold is on the node it comes out of, which is a
    // button standing where the rest of the history would be.
    drawn.add({
      id: `${repository.id}collapse-edge`,
      from: onCommit(`${repository.id}collapse`),
      to: onCommit(commitNodeId(repository, oldest.commit.id)),
      // The same S every line off the row takes; level ends make it straight.
      curve: true,
      trim: 0,
      lead: 0,
      stroke: { colour: LINE_COLOR, width: 1.2, opacity: 0.5, dash: "4 5" },
    });
  }

  // A branch is the curve from the commit it points at out to the column every
  // branch stands in, with the name set along the curve. The head is a node
  // like any other, so a branch with no commits of its own still shows up.
  for (const ref of refs) {
    // Where this branch's own mark is. The remote end of a branch hangs a
    // little under the row its local end stands on, which is what makes the
    // pair read as one branch drawn twice rather than as two branches.
    const at: Point = { x: ring, y: branchLine[ref.row] + (ref.under ? PAIR_DROP : 0) };

    nodes.push({
      id: ref.id,
      type: "head",
      parentId: repository.id,
      extent: "parent",
      position: { x: heads, y: at.y - LANE_HEIGHT / 2 },
      data: ref.data,
      style: CELL_STYLE,
      draggable: false,
      selectable: false,
    });

    // Drawn from the commit the branch points at outwards, which is the
    // direction the name reads. The name rides the curve rather than sitting
    // beside the head, and the curve itself stops at the ring rather than
    // crossing the hole in it.
    const reaches = shortOf(dots[ref.from], at, RING_TRIM, true);
    drawn.add({
      id: `${ref.id}branch`,
      from: onCommit(commitNodeId(repository, history.placed[ref.from].commit.id)),
      to: onCell(ref.id),
      curve: true,
      trim: RING_TRIM,
      lead: 0,
      stroke: {
        colour: LINE_COLOR,
        width: 1.1,
        opacity: 0.72,
        // A local branch is drawn solid whether or not it has a directory yet:
        // it is a place you can work in either way, and the worktree is made on
        // the way in. Only a remote-tracking branch is dashed, because that one
        // really is somewhere else.
        dash: ref.data.kind === "remote" ? "4 5" : undefined,
      },
      name: labelOf(ref.data.name, ref.note, dots[ref.from], reaches),
    });

    // Where this branch's terminals stand: a stack centred on the branch's own
    // line, opening out either way as it grows. What is actually in it is
    // `build`'s to fill — the room was made here, because a stack pushes the
    // branches either side of it away and that is the shape of the band.
    //
    // A remote branch is somewhere else: nothing can be opened in it, so
    // nothing stands there.
    if (ref.data.kind !== "remote") {
      runs.push({
        head: ref.id,
        cwd: ref.data.cwd,
        at,
        x: working - SESSION_WIDTH / 2,
        y: at.y - CLI_STEP / 2,
      });
    }
  }

  // The band is as tall as what is in it and no taller: whichever of the name,
  // the history and the branch column reaches furthest down.
  const bottom = Math.max(
    nameLine + LANE_HEIGHT / 2,
    historyLine(Math.max(history.depth - 1, 0)) + COMMIT_STEP.y / 2,
    rows > 0 ? branchLine[rows - 1] + rowReach(stacks[rows - 1]) : 0,
  );

  return {
    repository,
    data: {
      repository,
      label: {
        x: 0,
        y: nameLine - LANE_HEIGHT / 2,
        width: NAME_COLUMN * COLUMN_WIDTH,
        height: LANE_HEIGHT,
      },
    },
    style: {
      // Where the terminals stand is part of the band whether or not anything
      // is standing there: the room belongs to the repository the way the name
      // column does, and a band that widened the moment a terminal opened in it
      // would move every repository beside it.
      width: Math.max(MIN_BAND_WIDTH, working + SESSION_WIDTH / 2),
      height: bottom,
    },
    nodes,
    lines: drawn.done(),
    runs,
  };
}

/** How history itself is drawn. */
const HISTORY_STROKE: StrokeStyle = { colour: LINE_COLOR, width: 1.2, opacity: 0.82 };
