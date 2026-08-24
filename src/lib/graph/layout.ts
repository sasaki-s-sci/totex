import type { Branch, Commit, Repository, Worktree } from "../../types/git";
import { groupBy } from "../collections";
import { midpointOf, type Point, samplesOf, shortOf } from "./geometry";
import {
  type BandLines,
  type BranchHeadData,
  type BranchHeadFlowNode,
  CELL_STYLE,
  CHIP_STEP,
  CLI_CLEAR,
  COLUMN_WIDTH,
  type CollapseFlowNode,
  type CommitFlowNode,
  DEFAULT_VISIBLE_COMMITS,
  type FoldTarget,
  type GraphLine,
  LANE_HEIGHT,
  type Label,
  LINE_COLOR,
  MIN_BAND_WIDTH,
  NAME_COLUMN,
  onCell,
  type RepositoryNodeData,
  RING_TRIM,
  SESSION_WIDTH,
  STACK_TOP,
  type StrokeStyle,
  stackReach,
} from "./model";

/**
 * One repository, laid out: where every commit, branch head, button and offer
 * goes inside the band that holds them.
 *
 * A band is read left to right in three parts, and each of them answers a
 * different question:
 *
 *   - the history, which is the tree of what depends on what;
 *   - the branches, every one of them in a single column, so that what the
 *     repository has is one thing to read rather than a name to be found among
 *     the commits;
 *   - what is running in each branch, stacked straight down from that branch's
 *     own row, with the room for one more at the foot of every stack.
 *
 * A branch head therefore no longer stands where the branch was cut. It stands
 * where every other branch stands, and the line out of the commit it points at
 * is what says where it is — which is what a branch is: a name on a commit.
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

type Placed = {
  commit: Commit;
  lane: number;
  branches: Branch[];
  worktrees: Worktree[];
  boundary: boolean;
  folded: boolean;
};

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

export function prepare(
  repository: Repository,
  want: number | undefined,
  deep: Depth,
): PreparedRepository {
  // Settled here rather than inside the layout, so the cache is keyed by the
  // history that was actually drawn: asking for more than there is, or for the
  // default, must not count as a different graph.
  const shown = Math.max(
    1,
    Math.min(
      repository.commits.length,
      want ?? visibleCount(repository.commits, trunkOf(repository)?.commit),
    ),
  );
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

export function commitNodeId(repository: Repository, sha: string): string {
  return `${repository.id}commit${sha}`;
}

/** Every node and line one repository contributes, relative to its band. */
function layout(repository: Repository, shown: number, deep: Depth): PreparedRepository {
  const { placed, index, columns, refs, hidden, row, width, height } = place(
    repository,
    shown,
    deep,
  );

  // The mark the band opens with, which is what the name is set beside: the
  // fold where there is history behind it, and the oldest commit drawn where
  // there is not. Both stand in the column straight after the name's.
  //
  // The fold keeps the trunk's own row, so a name hung off the trunk was level
  // with it either way — until the history ran out on a line other than the
  // trunk, and the name then led a stretch of history that was not the one it
  // was set against.
  const opening = hidden > 0 ? undefined : placed[placed.length - 1];
  const nameRow = opening === undefined ? row(0) : row(signedRow(opening.lane));

  const nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode)[] = [];
  const drawn = new Lines();
  const runs: BranchRun[] = [];

  // Where every commit's dot ends up, which is where the lines into and out of
  // it are drawn from. A line runs mark to mark, and a mark is the middle of
  // its cell — so this is the cell's middle and not its corner.
  const dots = placed.map((entry, position) =>
    middleOf(columns[position], row(signedRow(entry.lane))),
  );
  // Where every branch stands, which is where the line out of its commit ends
  // and where a terminal working in it is joined to.
  const rings = new Map<string, Point>();
  for (const ref of refs) {
    rings.set(ref.id, middleOf(ref.column, row(ref.row)));
  }

  for (const [position, entry] of placed.entries()) {
    const column = columns[position];
    const node: CommitFlowNode = {
      id: commitNodeId(repository, entry.commit.id),
      type: "commit",
      parentId: repository.id,
      extent: "parent",
      position: {
        x: column * COLUMN_WIDTH,
        y: row(signedRow(entry.lane)),
      },
      data: {
        commit: entry.commit,
        repository,
        lane: entry.lane,
        branches: entry.branches,
        worktrees: entry.worktrees,
        boundary: entry.boundary,
        folded: entry.folded,
      },
      style: CELL_STYLE,
    };
    drawn.mark(dots[position], node);
    nodes.push(node);

    for (const parent of entry.commit.parents) {
      const parentPosition = index.get(parent);
      if (parentPosition === undefined) continue;
      const parentLane = placed[parentPosition].lane;

      // A line that stays in its row is drawn straight — which is what the same
      // curve degenerates to anyway, at a fraction of the work. One that moves
      // between rows takes the S, and that is what makes a fork or a merge
      // readable at a glance.
      const curve = entry.lane !== parentLane;
      const end = shortOf(dots[position], dots[parentPosition], 0, curve);

      drawn.add(
        {
          id: `${repository.id}${entry.commit.id}->${parent}`,
          from: onCell(commitNodeId(repository, entry.commit.id)),
          to: onCell(commitNodeId(repository, parent)),
          curve,
          trim: 0,
          lead: 0,
          stroke: HISTORY_STROKE,
        },
        // Folding here keeps everything from this commit forwards; what the
        // line runs down to, and all the history behind it, goes away.
        {
          keep: position + 1,
          hides: placed.length - (position + 1),
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
  if (hidden > 0) {
    const oldest = placed[placed.length - 1];

    nodes.push({
      id: `${repository.id}collapse`,
      type: "collapse",
      parentId: repository.id,
      extent: "parent",
      position: { x: NAME_COLUMN * COLUMN_WIDTH, y: row(0) },
      data: { repository, hidden },
      style: CELL_STYLE,
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
      from: onCell(`${repository.id}collapse`),
      to: onCell(commitNodeId(repository, oldest.commit.id)),
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
    nodes.push({
      id: ref.id,
      type: "head",
      parentId: repository.id,
      extent: "parent",
      position: { x: ref.column * COLUMN_WIDTH, y: row(ref.row) },
      data: ref.data,
      style: CELL_STYLE,
      draggable: false,
      selectable: false,
    });

    // Drawn from the commit the branch points at outwards, which is the
    // direction the name reads. The name rides the curve rather than sitting
    // beside the head, and the curve itself stops at the ring rather than
    // crossing the hole in it.
    const ring = rings.get(ref.id) as Point;
    const reaches = shortOf(dots[ref.from], ring, RING_TRIM, true);
    drawn.add({
      id: `${ref.id}branch`,
      from: onCell(commitNodeId(repository, placed[ref.from].commit.id)),
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
    if (ref.run) {
      runs.push({
        head: ref.id,
        cwd: ref.data.cwd,
        at: rings.get(ref.id) as Point,
        x: ref.run.x,
        y: row(ref.row) + STACK_TOP,
      });
    }
  }

  return {
    repository,
    data: {
      repository,
      label: { x: 0, y: nameRow, width: NAME_COLUMN * COLUMN_WIDTH, height: LANE_HEIGHT },
    },
    style: { width, height },
    nodes,
    lines: drawn.done(),
    runs,
  };
}

/** The middle of a cell of the grid, which is where its mark is drawn. */
function middleOf(column: number, top: number): Point {
  return { x: column * COLUMN_WIDTH + COLUMN_WIDTH / 2, y: top + LANE_HEIGHT / 2 };
}

/** Room left at the commit end of a branch line, for its dot. */
const DOT_CLEARANCE = 28;
/**
 * Room left at the head end.
 *
 * The head is a ring with a ring of canvas around it, and it is drawn over the
 * line rather than behind it — so a name that runs all the way to the end loses
 * its last letter or two under it. This is what keeps the name back on the near
 * side of the head, where it can be read whole.
 */
const HEAD_CLEARANCE = 22;
/** Rough advance per character at the name's size, wide characters apart. */
const NARROW = 3.3;
const WIDE = 6;

/**
 * A branch's name, cut to what its own line has room for, with what the branch
 * is to the repository set after it in brackets.
 *
 * Measured by eye rather than by the browser: laying the text out to find its
 * width would cost a reflow per branch, and being a character out only moves
 * where a name that was going to be cut short gets cut.
 *
 * The note is taken out of the room before the name is, and is never itself
 * cut: it is the shorter half and the one that says something the name cannot,
 * so a long branch name loses its own last letters rather than the word that
 * says the repository is standing on it.
 */
function labelOf(name: string, note: string | null, from: Point, to: Point): Label {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const tail = note === null ? "" : ` (${note})`;
  const room = span - DOT_CLEARANCE - HEAD_CLEARANCE - widthOf(tail);

  let width = 0;
  let kept = "";
  let text = name;
  for (const character of name) {
    width += advanceOf(character);
    if (width > room) {
      text = `${kept}…`;
      break;
    }
    kept += character;
  }

  return {
    full: `${name}${tail}`,
    text: `${text}${tail}`,
    // Set against the far end, where the curve has flattened out, and stopped
    // short of the head so the ring cannot cover the last letters. The straight
    // run stands in for the curve's own length, which is the longer of the two —
    // so this errs towards leaving more room, not less.
    at: span > HEAD_CLEARANCE ? 1 - HEAD_CLEARANCE / span : 0,
  };
}

/** Rough advance of one character at the name's size. */
function advanceOf(character: string): number {
  return (character.codePointAt(0) ?? 0) > 0x7f ? WIDE : NARROW;
}

/** Rough width of a run of text at the name's size, measured the same way. */
function widthOf(text: string): number {
  let width = 0;
  for (const character of text) {
    width += advanceOf(character);
  }
  return width;
}

/**
 * What a branch is to the repository, set after its name in brackets.
 *
 * Two of them are worth saying, and both are things a name cannot say for
 * itself: the branch the repository is standing on, and the one it treats as
 * its default — where a pull request lands, and what a new branch is cut from.
 * A branch that is neither, which is nearly all of them, is left as its name
 * alone; the brackets are what makes the two that matter stand out of a column
 * of names, so putting one on everything would be putting one on nothing.
 *
 * A branch can be both, and usually is — the repository is standing on its
 * default. That reads as one bracket saying both rather than two, because two
 * brackets on one name reads as two separate remarks about it.
 *
 * `fallback` is the default as git itself reports it, which `branchPriority`
 * explains: a full ref name, so it matches the branch's `refName` rather than
 * the shortened name that is drawn.
 */
function noteOf(ref: Ref, fallback: string | null): string | null {
  const notes: string[] = [];
  if (ref.head) notes.push("Head");
  if (fallback !== null && ref.refName === fallback) notes.push("default");
  return notes.length > 0 ? notes.join(", ") : null;
}

/** How history itself is drawn. */
const HISTORY_STROKE: StrokeStyle = { colour: LINE_COLOR, width: 1.2, opacity: 0.82 };

/**
 * How wide a cell of the fold index is.
 *
 * The grid the graph is laid out on, which is what makes looking a line up a
 * matter of dividing the pointer's position rather than of searching: a cell
 * holds the handful of lines that pass through it, and the pointer is only ever
 * in one cell.
 */
const INDEX_CELL = { x: COLUMN_WIDTH, y: LANE_HEIGHT };

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / INDEX_CELL.x)},${Math.floor(y / INDEX_CELL.y)}`;
}

/** Which cell of the index a point falls in. */
export function foldCell(at: Point): string {
  return cellKey(at.x, at.y);
}

/**
 * Collects a band's lines as they are worked out, and batches them at the end.
 *
 * Lines drawn the same way become one path: the canvas is thousands of lines
 * and a handful of ways of drawing one, so what the engine is handed is a
 * handful of elements rather than one per commit. A line carrying a name is
 * kept whole, because the name is set along that line and needs a path of its
 * own to be set along.
 */
class Lines {
  private readonly batches = new Map<string, { stroke: StrokeStyle; parts: GraphLine[] }>();
  private readonly named: GraphLine[] = [];
  private readonly folds = new Map<string, FoldTarget[]>();
  private readonly dots = new Map<string, { at: Point; node: CommitFlowNode }>();

  /** A commit's own mark, which the offer of a branch is drawn out of. */
  mark(at: Point, node: CommitFlowNode) {
    this.dots.set(foldCell(at), { at, node });
  }

  add(line: GraphLine, fold?: Fold) {
    if (line.name !== undefined) {
      this.named.push(line);
    } else {
      const key = strokeKey(line.stroke);
      const batch = this.batches.get(key);
      if (batch) batch.parts.push(line);
      else this.batches.set(key, { stroke: line.stroke, parts: [line] });
    }

    // Nothing behind it to fold away: the offer would say "hide zero commits".
    if (!fold || fold.hides <= 0) return;
    const run = samplesOf(fold.from, fold.to, fold.curve);
    const target: FoldTarget = {
      run,
      at: midpointOf(fold.from, fold.to, fold.curve),
      keep: fold.keep,
      hides: fold.hides,
    };
    // Every cell the line passes through answers for it, so the pointer finds
    // it wherever along the line it lands.
    for (const key of cellsOf(run)) {
      const held = this.folds.get(key);
      if (held) held.push(target);
      else this.folds.set(key, [target]);
    }
  }

  done(): BandLines {
    const strokes = [...this.batches].map(([key, batch]) => ({
      key,
      stroke: batch.stroke,
      parts: batch.parts,
    }));
    return {
      strokes,
      named: this.named,
      folds: this.folds,
      dots: this.dots,
    };
  }
}

/** What a line the pointer can fold at needs to know about itself. */
type Fold = {
  keep: number;
  hides: number;
  from: Point;
  to: Point;
  curve: boolean;
};

/** Two lines drawn this way are one path. */
function strokeKey(stroke: StrokeStyle): string {
  return `${stroke.colour}|${stroke.width}|${stroke.opacity}|${stroke.dash ?? ""}`;
}

/** Every cell of the index a run of points passes through. */
function cellsOf(run: readonly number[]): Set<string> {
  const cells = new Set<string>();
  for (let index = 0; index + 3 < run.length; index += 2) {
    // Along the piece rather than at its ends: a line crossing a cell without
    // stopping in it still has to answer there.
    const steps = Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(run[index + 2] - run[index]) / INDEX_CELL.x,
          Math.abs(run[index + 3] - run[index + 1]) / INDEX_CELL.y,
        ),
      ),
    );
    for (let step = 0; step <= steps; step++) {
      const at = step / steps;
      cells.add(
        cellKey(
          run[index] + (run[index + 2] - run[index]) * at,
          run[index + 1] + (run[index + 3] - run[index + 1]) * at,
        ),
      );
    }
  }
  return cells;
}

/**
 * The branch the repository is on, which lane zero and the middle row of the
 * band are held for.
 */
function trunkOf(repository: Repository): Branch | undefined {
  const head = repository.branches.find((branch) => branch.isHead);
  if (head) return head;

  // A detached or bare repository has no branch checked out; the branch git
  // itself would call the default one is the next best trunk.
  return repository.branches.find((branch) => branch.refName === repository.defaultBranch);
}

/** Sorts the history into lanes and columns, and measures the band it needs. */
function place(repository: Repository, shown: number, deep: Depth) {
  const branchesAt = groupBy(repository.branches, (branch) => branch.commit);
  const remoteNames = new Set(
    repository.branches
      .filter((branch) => branch.kind === "remote")
      .map((branch) => branch.logicalName),
  );
  // A worktree with no head is bucketed under a key no commit can have, which
  // is the same as leaving it out.
  const worktreesAt = groupBy(repository.worktrees, (worktree) => worktree.head ?? "");

  const trunk = trunkOf(repository);
  // The newest slice of history. What falls outside is not lost: it is behind
  // the collapse node, and the branches that pointed into it hang off that
  // instead.
  const commits = repository.commits.slice(0, shown);
  const hidden = repository.commits.length - shown;

  // Two different questions, and answering both with one set is what put a
  // stub of "the history ends here" on a commit whose parent was merely folded
  // away. `drawn` is what this graph has room for, and settles where the lines
  // can run; `known` is everything the repository handed over, and settles
  // whether there is any more history at all.
  const drawn = new Set(commits.map((commit) => commit.id));
  const known = new Set(repository.commits.map((commit) => commit.id));
  const packed = assignLanes(commits, drawn, trunk?.commit);
  // The one commit the collapse node's own dash already runs to, which is
  // therefore the one that needs no dash of its own.
  const oldest = commits.length - 1;
  const placed: Placed[] = commits.map((commit, position) => ({
    commit,
    lane: packed[position],
    branches: branchesAt.get(commit.id) ?? [],
    worktrees: worktreesAt.get(commit.id) ?? [],
    boundary: commit.parents.some((parent) => !known.has(parent)),
    // A lane is handed on as soon as the commit holding it is drawn, so a chain
    // whose parent was folded away is followed along the same row by whatever
    // chain took the lane next — two marks a column apart with nothing between
    // them, which reads as a line that failed to draw rather than as history
    // put away. The dash says which it is.
    folded:
      position !== oldest &&
      commit.parents.some((parent) => known.has(parent) && !drawn.has(parent)),
  }));

  // Which row every name is drawn on. A lane number is only ever read as the
  // row `signedRow` turns it into, so the packing's lanes are relabelled here
  // rather than anywhere further down: after this, reading a band from the top
  // spells its branch names out in order.
  const { lanes, want } = rowOrder(placed, trunk?.id, remoteNames);
  for (const entry of placed) entry.lane = lanes.get(entry.lane) ?? entry.lane;

  const index = new Map(placed.map((entry, position) => [entry.commit.id, position]));

  // A branch pointing into the history that is not shown is not shown either:
  // folding a stretch of history away means folding away what is on it — the
  // branches, their worktrees and the buttons that work in them. The collapse
  // node says how much went, and expanding brings all of it back.
  const anchored = anchorRefs(placed, trunk?.id, remoteNames, want);
  const { columns: own, count: span } = assignColumns(placed, index);

  // The name takes the first column, the collapse node the next when there is
  // one, and the history follows.
  const shift = NAME_COLUMN + (hidden > 0 ? 1 : 0);
  const columns = own.map((column) => column + shift);
  const count = span + shift;

  // Where the history stops and the branches begin: the column after the last
  // commit of the longest line, so that the branch column is past the whole of
  // the history however uneven the lines in it are.
  const branch = count;
  // And what everything hanging off a branch is measured from: the ring itself
  // rather than the edge of its cell, so that the two things beside a branch —
  // the branch it could be cut into, and the terminals running in it — read as
  // that branch's own and not as a row of their own.
  const ring = branch * COLUMN_WIDTH + COLUMN_WIDTH / 2;

  const refs = placeRefs(anchored, repository, branch, ring);

  // Everything now has a row counted from the trunk, and the rows are no longer
  // all the same distance apart: a branch running several terminals opens the
  // stack out either way from its own row, so the rows either side of it have
  // to stand clear of half of it each. `pitch` is that measured out, and it is
  // where the whole band is hung from.
  const rows = placed.map((entry) => signedRow(entry.lane));
  const held = new Map<number, number>();
  for (const ref of refs.placements) {
    if (!ref.run || !ref.data.cwd) continue;
    // What is running there, and nothing else: the offer is a button on the
    // branch's own ring now, so a branch with nothing in it asks for no room
    // out here. Every row carrying a stack at all, however short: half of one
    // hangs over the row above, so a gap is a sum over both of the rows it lies
    // between.
    const marks = deep.get(ref.data.cwd) ?? 0;
    if (marks > 0) held.set(ref.row, marks);
  }
  const pitch = spacing(Math.min(refs.top, ...rows, 0), Math.max(refs.bottom, ...rows, 0), held);

  // How far the band reaches either side of the trunk: the rows, and half of
  // whatever stack each branch is carrying at each end of them.
  let top = 0;
  let bottom = 0;
  for (const at of [...rows, 0]) {
    top = Math.min(top, pitch(at));
    bottom = Math.max(bottom, pitch(at));
  }
  for (const ref of refs.placements) {
    top = Math.min(top, pitch(ref.row));
    bottom = Math.max(bottom, pitch(ref.row));
    const marks = held.get(ref.row);
    // Both ends of the stack, said as the top edge of the row each end would
    // need: the band gives a lane's height under whatever reaches furthest
    // down, and the top of a stack now reaches up as well — a mark drawn past
    // the band's own edge is a mark cut off there, because a band clips what is
    // drawn in it.
    if (marks !== undefined) {
      const reach = stackReach(marks);
      top = Math.min(top, pitch(ref.row) + STACK_TOP - reach);
      bottom = Math.max(bottom, pitch(ref.row) + STACK_TOP + reach);
    }
  }
  // The band is as tall as what is in it and no taller. It used to be padded to
  // the same reach either side of the trunk, so that the trunk came out in the
  // middle of every repository — but the bands go down a column one under the
  // next now, with nothing beside them to be level with, so the padding bought
  // nothing and cost a blank half-band above any repository whose lowest branch
  // was running several terminals.
  const above = -top;
  // Where the terminals stand, which is what the band has to be wide enough to
  // hold whether or not anything is standing there: the room is part of the
  // repository the way the name column is, and a repository that widened the
  // moment a terminal opened in it would move every repository beside it.
  const working = ring + CHIP_STEP;
  return {
    placed,
    index,
    columns,
    refs: refs.placements,
    hidden,
    /** Band-relative top of the cell a row's marks are drawn in. */
    row: (at: number) => above + pitch(at),
    width: Math.max(MIN_BAND_WIDTH, working + SESSION_WIDTH / 2),
    height: above + bottom + LANE_HEIGHT,
  };
}

/**
 * How far each row sits from the trunk's, once the stacks have had their room.
 *
 * A stack is centred on its own row, so a gap is a sum over the two rows it
 * lies between: what the upper one reaches down, what the lower one reaches up,
 * and a `CLI_CLEAR` between the two marks that meet. A lane holds a branch and
 * one terminal without any of that showing — two of those reach half a step
 * towards each other and the clearance is exactly what a lane has spare — so
 * nothing moves until a branch is running two at once. Past that, the marks
 * either side of a boundary end up about as far apart as the marks within a
 * stack, so a crowded branch reads as a longer column rather than as a row that
 * has burst.
 *
 * Measured out once, into a table, rather than answered by walking the branches
 * every time: this is asked for every commit and every branch in the band.
 */
function spacing(
  from: number,
  to: number,
  /** How many marks each row's stack holds, for every row that has one. */
  held: ReadonlyMap<number, number>,
): (row: number) => number {
  const at = new Map<number, number>([[0, 0]]);

  let below = 0;
  for (let row = 0; row < to; row++) {
    below += gapBetween(held.get(row), held.get(row + 1));
    at.set(row + 1, below);
  }
  let above = 0;
  for (let row = 0; row > from; row--) {
    above -= gapBetween(held.get(row - 1), held.get(row));
    at.set(row - 1, above);
  }

  return (row) => at.get(row) ?? row * LANE_HEIGHT;
}

/** How far apart two neighbouring rows stand, given what each of them carries. */
function gapBetween(upper: number | undefined, lower: number | undefined): number {
  return Math.max(LANE_HEIGHT, reachOf(upper) + reachOf(lower) + CLI_CLEAR);
}

/** How far a row's stack reaches past its own line, for a row that has one. */
function reachOf(marks: number | undefined): number {
  return marks === undefined ? 0 : stackReach(marks);
}

/**
 * How many commits to show when nobody has asked for more.
 *
 * Always enough to reach the tip of the line the repository is on: a graph that
 * hid the commit you are sitting on would be answering the wrong question.
 */
function visibleCount(commits: Commit[], trunk: string | undefined): number {
  const count = Math.min(DEFAULT_VISIBLE_COMMITS, commits.length);
  if (trunk === undefined) return count;
  const at = commits.findIndex((commit) => commit.id === trunk);
  return at === -1 ? count : Math.max(count, at + 1);
}

/**
 * Which row a line of development is drawn on, counted from the trunk.
 *
 * Rows are signed, and the trunk is row zero: everything else takes the rows
 * either side of it, lane 1 the row above and lane 2 the row below, outwards
 * from there. Which line gets which row is not settled here — `rowOrder`
 * relabels the lanes so the names read down the band — and a lane number is
 * nothing but a row said the other way round.
 *
 * Working in this space rather than in lane numbers is what lets everything
 * else ask for "the row next to that one" and mean it — lane order and row
 * order are not the same, and a branch placed one lane from its commit used to
 * come out several rows away from it.
 *
 * The band is squared up at the very end, in `bandRows`.
 */
function signedRow(lane: number): number {
  if (lane === 0) return 0;
  const distance = Math.ceil(lane / 2);
  return lane % 2 === 1 ? -distance : distance;
}

/**
 * Which row every name is drawn on, and the lanes relabelled to match.
 *
 * Lane packing deals its lanes out in the order the log arrives, so the row a
 * branch came out on said nothing about the branch: the same repository drawn
 * one commit later could swap two of them over, and a band of a dozen branches
 * was a dozen names in no order at all. They are sorted here instead, and the
 * rows either side of the trunk are dealt out in that order — so reading a band
 * downwards reads its branches alphabetically.
 *
 * The trunk is not in the alphabet. It keeps lane zero and the middle of the
 * band, which is what every other row is counted from.
 *
 * Neither is a line with no name on it — history that was merged back in, whose
 * branch is gone. Those keep the rows nearest the trunk, where the packing had
 * them and where their merges stay short, and the names take the rows that are
 * left.
 */
function rowOrder(placed: Placed[], trunk: string | undefined, remoteNames: ReadonlySet<string>) {
  const named: { key: string; name: string; lane: number }[] = [];
  const lanes = new Set<number>();

  for (const entry of placed) {
    if (entry.lane !== 0) lanes.add(entry.lane);
    if (!hasRefs(entry)) continue;
    for (const ref of refsOf(entry, trunk, remoteNames)) {
      if (ref.trunk || ref.head) continue;
      named.push({ key: ref.key, name: ref.name, lane: entry.lane });
    }
  }
  named.sort((left, right) => byName(left.name, right.name));

  const carrying = new Set(named.map((ref) => ref.lane));
  const nameless = [...lanes]
    .filter((lane) => !carrying.has(lane))
    .sort((left, right) => left - right);

  // A row each, for every name and every nameless line. Two branches that never
  // shared a column could have shared a row before; they cannot now, because a
  // row is what says where a name comes in the order.
  const total = named.length + nameless.length;
  const above = Math.ceil(total / 2);
  const rowAt = (rank: number) => (rank < above ? rank - above : rank - above + 1);

  /** The row each of the packing's lanes is drawn on. */
  const rows = new Map<number, number>();
  const held = new Set<number>();
  for (const [at, lane] of nameless.entries()) {
    const distance = Math.floor(at / 2) + 1;
    const row = at % 2 === 0 ? -distance : distance;
    rows.set(lane, row);
    held.add(row);
  }

  const want = new Map<string, number>();
  let rank = 0;
  for (const ref of named) {
    while (held.has(rowAt(rank))) rank++;
    const row = rowAt(rank);
    rank++;
    want.set(ref.key, row);
    // The line a name stands on is drawn on that name's row. Where two names
    // stand on one line — a branch and the remote-tracking ref beside it — the
    // first of them in the alphabet has the line, and the other is a head of
    // its own, a row away.
    if (ref.lane !== 0 && !rows.has(ref.lane)) rows.set(ref.lane, row);
  }

  // Back into lane numbers, which is the only form the rest of the layout takes
  // a row in: `signedRow` reads lane 1 as the row above the trunk, lane 2 as the
  // one below, and so on outwards.
  const relabelled = new Map<number, number>();
  for (const [lane, row] of rows) relabelled.set(lane, row < 0 ? -row * 2 - 1 : row * 2);

  return { lanes: relabelled, want };
}

/**
 * Names in the order git itself puts them in, which is the order the backend
 * hands the branches over in.
 */
function byName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The order branches cut at one commit fan in.
 *
 * The one that is checked out takes the slot level with the commit, so the line
 * being worked on carries straight on; the repository's own default branch is
 * next, and everything else follows.
 *
 * `fallback` is the repository's default as git itself reports it — resolved
 * from `refs/remotes/*\/HEAD` where there is one, and from git's own list of
 * conventional names where there is not. Asking it rather than guessing at
 * `main`/`master` here is what lets a repository whose default is `develop`,
 * `trunk`, or anything renamed still lead its own fan.
 */
function branchPriority(ref: Ref, fallback: string | null): number {
  // First in either case, and for the same reason: the line the repository is
  // on is the one everything else is measured against, and it claims the row
  // level with its commit.
  if (ref.head || ref.trunk) return 0;
  if (fallback !== null && ref.refName === fallback) return 1;
  return 2;
}

/**
 * Where along the history each commit sits.
 *
 * A commit takes the column after the last of its parents, which is what makes
 * the picture a graph rather than a list: a branch starts at the very commit it
 * was cut from, and the work that happened in parallel is drawn in parallel.
 * Reading the position out of `git log`'s own order cannot do this — the log
 * hands back a branch's commits in one run, so the branch would begin wherever
 * that run happens to fall instead of at the fork.
 *
 * A lane never has two commits in one column: `next` holds the first column
 * each lane is still free in, and no commit is placed before it. Nothing else
 * moves a commit along the axis — one column is one commit, and the gaps that
 * do appear are the history's own, a merge waiting on a branch to finish.
 *
 * Nothing but commits is placed here. The branches stand in a column of their
 * own past the whole of this, so no commit has to make room for one.
 */
function assignColumns(placed: Placed[], index: Map<string, number>) {
  const columns = new Array<number>(placed.length);
  const next: number[] = [];
  let count = 0;

  // Oldest first — the order the history arrives in, reversed — so every parent
  // that was loaded already has its column by the time its children ask for it.
  for (let position = placed.length - 1; position >= 0; position--) {
    const entry = placed[position];
    let column = next[entry.lane] ?? 0;

    for (const parent of entry.commit.parents) {
      const at = index.get(parent);
      // A parent from beyond the loaded history says nothing about where this
      // commit belongs; its lane is then all there is to go on. One that has
      // not been placed yet means the history did not arrive oldest-last, which
      // `--topo-order` promises — reading its column then would be reading a
      // hole, and one `NaN` here takes the whole canvas down with it.
      if (at === undefined || at < position) continue;
      column = Math.max(column, columns[at] + 1);
    }

    columns[position] = column;
    next[entry.lane] = column + 1;
    count = Math.max(count, column + 1);
  }

  return { columns, count };
}

/** A branch head, and the cell of the grid it was given. */
type RefPlacement = {
  id: string;
  data: BranchHeadData;
  /** The commit the branch points at, which the line to it is drawn from. */
  from: number;
  column: number;
  /** Counted from the trunk, so it can be either side of it. */
  row: number;
  /** What this branch is to the repository, set after its name; see `noteOf`. */
  note: string | null;
  /** Where a terminal working in this branch stands; null where none can. */
  run: RunPlacement | null;
};

type RunPlacement = {
  /** Band-relative corner of the stack's first box; the row is the branch's own. */
  x: number;
};

/** A branch or worktree name, and what can be done where it points. */
type Ref = ReturnType<typeof refsOf>[number];

/** A branch head and the commit it points at, before rows are settled. */
type Anchored = {
  ref: Ref;
  /** The commit it points at, which the line to it is drawn from. */
  from: number;
  /** The row it would rather have: the one its name asks for, or its line's. */
  home: number;
};

/**
 * Which commit each branch points at, and which row it asks for.
 *
 * A branch is a name on a commit, and that is the whole of what anchors it: the
 * head stands in the branch column whatever it was cut from, and the line back
 * to this commit is what says where the branch actually is.
 *
 * The row it asks for is the one its name was given in `rowOrder` — which for
 * the name a line of development is drawn under is that line's own row, so its
 * head comes out level with the commits it points into and the line between
 * them is straight.
 */
function anchorRefs(
  placed: Placed[],
  trunk: string | undefined,
  remoteNames: ReadonlySet<string>,
  want: ReadonlyMap<string, number>,
): Anchored[] {
  const anchored: Anchored[] = [];

  for (const [position, entry] of placed.entries()) {
    if (!hasRefs(entry)) continue;
    const line = signedRow(entry.lane);
    for (const ref of refsOf(entry, trunk, remoteNames)) {
      // The trunk is not in the alphabet and keeps its own row; every other
      // name has one of its own, which for the name a line is drawn under is
      // that line's row.
      anchored.push({ ref, from: position, home: want.get(ref.key) ?? line });
    }
  }

  return anchored;
}

/**
 * Where each branch goes: a row of the one column they all stand in.
 *
 * The column is past the whole of the history, so nothing a branch could
 * collide with is in it but another branch — which is the point of the column.
 * What a head has to be given is a row, and it asks for the one its name was
 * dealt in `rowOrder`: reading the column downwards then reads the repository's
 * branches in order, and the one drawn under a line of development comes out
 * level with that line.
 *
 * Two names can still want one row — a branch and the remote-tracking ref
 * beside it point at the same commit — so a name whose row is taken takes the
 * nearest free one. Branches are ordered before that search, so the checked-out
 * one gets first refusal on the row its own line runs along, and where two
 * names want one row the one the alphabet puts first has it.
 *
 * `ring` is where a head's own mark stands in the column, which is what
 * everything hanging off it is measured from.
 */
function placeRefs(anchored: Anchored[], repository: Repository, column: number, ring: number) {
  const placements: RefPlacement[] = [];

  // One column, so a row is either free or it is not.
  const taken = new Set<number>();

  const ordered = [...anchored].sort(
    (left, right) =>
      branchPriority(left.ref, repository.defaultBranch) -
        branchPriority(right.ref, repository.defaultBranch) ||
      byName(left.ref.name, right.ref.name),
  );

  // The terminals stack out past the branch's own ring, in a column of their
  // own that no line of the history ever crosses.
  const working = ring + CHIP_STEP;

  let top = 0;
  let bottom = 0;

  for (const entry of ordered) {
    const row = freeRow(taken, entry.home);
    taken.add(row);

    const id = `${repository.id}ref${entry.ref.key}`;

    // Where what is running in this branch stands, beside it. A remote branch
    // is somewhere else: nothing can be opened in it, so nothing stands there.
    const run: RunPlacement | null =
      entry.ref.kind === "remote" ? null : { x: working - SESSION_WIDTH / 2 };

    placements.push({
      id,
      data: {
        repository,
        kind: entry.ref.kind,
        name: entry.ref.name,
        hasRemote: entry.ref.hasRemote,
        cwd: entry.ref.cwd,
      },
      from: entry.from,
      column,
      row,
      note: noteOf(entry.ref, repository.defaultBranch),
      run,
    });

    top = Math.min(top, row);
    bottom = Math.max(bottom, row);
  }

  return { placements, top, bottom };
}

/**
 * The row nearest the one a branch wanted that no other branch has taken.
 *
 * Every branch stands in one column, so the search is a row at a time outwards
 * from the one it asked for — there is no line of development out here for its
 * own line to have to cross, and nothing else in the column to go round.
 */
function freeRow(taken: ReadonlySet<number>, home: number): number {
  if (!taken.has(home)) return home;
  for (let step = 1; ; step++) {
    for (const row of [home - step, home + step]) {
      if (!taken.has(row)) return row;
    }
  }
}

/**
 * The names pointing at a commit, in the order they are drawn.
 *
 * A branch is checked out in at most one worktree, so the branch name already
 * identifies it and the folder name is left off. Only a worktree with no branch
 * of its own — a detached one — is named after itself.
 */
function refsOf(entry: Placed, trunk: string | undefined, remoteNames: ReadonlySet<string>) {
  const named = new Set<string>();

  const branches = entry.branches.map((branch) => {
    const checkout = entry.worktrees.find((worktree) => branch.checkedOutIn.includes(worktree.id));
    for (const worktree of entry.worktrees) {
      if (branch.checkedOutIn.includes(worktree.id)) named.add(worktree.id);
    }
    return {
      key: branch.id,
      name: branch.name,
      /** How the backend spells it, which is what `defaultBranch` names. */
      refName: branch.refName,
      kind: branch.kind === "remote" ? ("remote" as const) : ("local" as const),
      // A local branch and its remote-tracking counterpart are separate refs,
      // but the local ring still says when the branch also exists elsewhere.
      hasRemote: branch.kind === "remote" || remoteNames.has(branch.logicalName),
      trunk: branch.id === trunk,
      head: branch.isHead,
      cwd: checkout?.path ?? null,
      commit: branch.commit,
    };
  });

  const detached = entry.worktrees
    .filter((worktree) => !named.has(worktree.id))
    .map((worktree) => ({
      key: worktree.id,
      name: worktree.name,
      refName: null,
      kind: "worktree" as const,
      hasRemote: false,
      trunk: false,
      head: false,
      cwd: worktree.path,
      commit: worktree.head ?? "",
    }));

  // Unordered: which of these leads the fan is `placeRefs`'s to decide.
  return [...branches, ...detached];
}

function hasRefs(entry: Placed): boolean {
  return entry.branches.length > 0 || entry.worktrees.length > 0;
}

/**
 * Classic lane packing, walking newest to oldest: a commit takes the lane its
 * children reserved for it, its first parent inherits that lane, and every
 * other parent opens a lane of its own. Lanes are released as soon as the
 * commit that reserved them is drawn, so the tree stays shallow.
 *
 * `trunk` is the tip of the branch the repository is on. Lane zero is held for
 * it, so the line the work is happening on runs across the top of the band and
 * the branches hang off it — rather than lane zero going to whichever tip the
 * log happened to print first, which leaves the trunk looking like a branch of
 * a branch.
 *
 * What this settles is which commits belong to one line of development, not
 * where that line is drawn: the numbers it deals out are relabelled by
 * `rowOrder` before anything reads a row out of them.
 */
function assignLanes(commits: Commit[], drawn: Set<string>, trunk: string | undefined) {
  const reserved: (string | null)[] = trunk !== undefined && drawn.has(trunk) ? [trunk] : [];
  const lanes: number[] = [];

  const firstFree = () => {
    const free = reserved.indexOf(null);
    if (free !== -1) return free;
    reserved.push(null);
    return reserved.length - 1;
  };

  const waiting: number[] = [];
  for (const commit of commits) {
    // Indexed rather than `entries()`: this runs once per lane per commit, and
    // at five thousand commits the tuples it would allocate are the bulk of
    // what laying a repository out costs.
    waiting.length = 0;
    for (let lane = 0; lane < reserved.length; lane++) {
      if (reserved[lane] === commit.id) waiting.push(lane);
    }

    const lane = waiting.length > 0 ? waiting[0] : firstFree();
    // Several children can converge here; all but one of their lanes end.
    for (const other of waiting) reserved[other] = null;
    reserved[lane] = null;

    lanes.push(lane);

    for (const [parentIndex, parent] of commit.parents.entries()) {
      if (!drawn.has(parent)) continue;
      // The first parent carries on this commit's own line even when another
      // line is already waiting for it. The parent then has two lanes waiting,
      // takes the lower of them, and the other ends there — which is what keeps
      // a long-lived line whole instead of handing it to the first branch that
      // happened to be cut from it.
      if (parentIndex === 0 && reserved[lane] === null) {
        reserved[lane] = parent;
        continue;
      }
      if (reserved.includes(parent)) continue;
      const target = firstFree();
      reserved[target] = parent;
    }
  }

  return lanes;
}
