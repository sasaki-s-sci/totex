import type { Folder } from "../../hooks/useWorkspace";
import type { Workspace } from "../../types/git";
import type { Ask } from "../ask";
import { groupBy } from "../collections";
import type { Report } from "../mcp";
import { ordinalOf, type Session } from "../session";
import {
  ASK_GAP,
  ASK_STACK_GAP,
  ASK_WIDTH,
  ASK_Z,
  type AskFlowNode,
  type AskNodeData,
  askCard,
} from "./asking";
import {
  FOLDER_MARK_X,
  FOLDER_ROW_WIDTH,
  folderId,
  folderRow,
  isOpen,
  markId,
  repoMark,
} from "./folders";
import { type PreparedRepository, prepare } from "./layout";
import {
  type AppNode,
  type Band,
  CHIP_STEP,
  CLI_MARK,
  CLI_STEP,
  CLI_STROKE,
  type CliFlowNode,
  type CliNodeData,
  type Draw,
  FOLDER_GAP_Y,
  FOLDER_INSET,
  FOLDER_MARK,
  FOLDER_STROKE,
  type FolderFlowNode,
  type GraphLine,
  type GraphResult,
  type Group,
  inBand,
  LANE_HEIGHT,
  type LineEnd,
  onCell,
  onStack,
  REPO_GAP_Y,
  REPO_MARK_RING,
  REPO_MARK_WIDTH,
  type RepoMarkFlowNode,
  type RepositoryFlowNode,
  RING_TRIM,
  rowPitch,
  rowReach,
  SESSION_WIDTH,
  STACK_STYLE,
  STEP,
  type StrokeStyle,
  stackReach,
} from "./model";
import { type ReportFlowNode, type ReportNodeData, reportCard } from "./reporting";

/** A node the build looks up rather than taking from a cached layout. */
type Held =
  | RepositoryFlowNode
  | FolderFlowNode
  | RepoMarkFlowNode
  | CliFlowNode
  | AskFlowNode
  | ReportFlowNode;

/**
 * The canvas: one column per folder, and in each of them a row per repository
 * — folded into a single mark, or opened out into a band of its own history —
 * with what is running in each of those rows standing beside it.
 *
 * Everything goes down the page. A folder is the unit somebody put on the graph
 * and it is the unit the canvas is arranged in: its row, and under it the
 * repositories it holds, each set in by one column and joined back to the
 * folder's own mark. So a repository is always in the same place — under its
 * folder, in the order the folder gave — whether it is showing a mark or a
 * thousand commits, and folding one changes what is drawn rather than where
 * anything is.
 *
 * The layouts themselves are cached per repository, so this is the only part
 * that runs when a terminal opens, a fold changes what is shown, or a commit
 * lands somewhere else — and what it does not rebuild comes back as the very
 * objects React Flow already has.
 *
 * A branch carries a stack of the terminals this window has opened in it, in
 * the order they were opened, and nothing at all while it is running nothing.
 * The offer of one is the button on the branch's own ring — see
 * `BranchHeadNode` — so pressing that button puts a mark in the column beside
 * it, which is the whole of what happens on the canvas when work begins.
 *
 * A terminal working somewhere no branch is drawn for — in a folder itself, or
 * in a repository that is folded away — stands beside the row that does draw
 * it: the folder's own row, or that repository's mark. There is no column of
 * homeless terminals off the side of the canvas any more; every one of them is
 * a step from the thing it is working in, which is what a line between them was
 * having to say by crossing the whole graph.
 *
 * This window's own terminals and nothing else. One somebody opened somewhere
 * else cannot be shown in the panel, typed into or ended from here — a pty
 * belongs to the process that made it — and a mark that answers to none of
 * those is a list entry rather than a thing on a canvas.
 */

/**
 * Turns a scanned workspace into a commit graph for React Flow.
 *
 * `previous` is the graph this one replaces: whatever it already holds in the
 * shape we would have built is handed back rather than rebuilt as an equal
 * copy, so the difference between two graphs is exactly what moved.
 */
export type GraphInput = {
  workspace: Workspace;
  /** The folders the graph was opened on, in the order they were opened. */
  folders: readonly Folder[];
  /**
   * How much history each repository is showing, by id: what a fold or an
   * expand asked for. A repository that has not been asked shows the default.
   */
  visible: ReadonlyMap<string, number>;
  /**
   * Which repositories are opened out into bands, by id.
   *
   * Absent is not closed: a folder holding one repository opens it, and one
   * holding several starts with all of them folded into marks. See `isOpen`.
   */
  opened: ReadonlyMap<string, boolean>;
  /** What this window is running, in the order it was opened. */
  sessions: readonly Session[];
  /** The session the panel is showing, if any. */
  showing: string | null;
  /**
   * What each session is being asked, by session id.
   *
   * The one thing on this canvas that is a turn rather than a state: an agent
   * that has stopped to ask is waiting on the person at the window, and until
   * it is answered nothing else in that session is going to happen. Nearly
   * always empty — see `useAsks`.
   */
  asks: ReadonlyMap<string, Ask>;
  /**
   * What each session says it is working on, by session id.
   *
   * The other of the two things a terminal can have standing beside it, and the
   * quiet one: nothing is waiting, the agent is working, and this is its own
   * account of what it is working on. Empty until somebody has stood the server
   * up and registered it with their agent — see `useReports`.
   */
  reports: ReadonlyMap<string, Report>;
  /**
   * The repository a pull is under way in, if any.
   *
   * Its depth in `visible` is the one the hand has reached rather than the one
   * it has settled on, so everything drawn from it is drawn as a proposal. No
   * other repository is affected: a pull is one hand on one fold.
   */
  reaching: string | null;
  /**
   * How far each folder has been carried from where it would be laid out, by
   * the directory it was opened on.
   *
   * A move rather than a place: the folders are stacked down the canvas in the
   * order they were opened, and a group that has been dragged is drawn that far
   * from the slot it still holds. So the one that was moved is the only one
   * that moved — the folder under it is where it always was, and a repository
   * opening out above still pushes both of them down together.
   */
  places: ReadonlyMap<string, { x: number; y: number }>;
};

export function buildCommitGraph(
  {
    workspace,
    folders,
    visible,
    opened,
    sessions,
    showing,
    asks,
    reports,
    reaching,
    places,
  }: GraphInput,
  previous?: GraphResult,
): GraphResult {
  // By the directory it runs in, not the branch it was started from: a branch
  // cut to be named by the agent working in it is renamed while that agent is
  // still running, and the number a second terminal is told apart by has to be
  // the same one before and after.
  const open = groupBy(sessions, (session) => session.cwd);

  // How many marks each branch's stack will hold, worked out before anything is
  // laid out: a stack that is deeper than the lane it hangs in pushes the rows
  // under it down, which is a shape rather than a filling and so is the
  // layout's own business. Every one of them, crowded or not — a stack is
  // centred on its branch's own line, so the room it takes is split between the
  // row above it and the row below, and the gap between two rows is a sum over
  // both of their stacks. A branch running one terminal reaches half a step up
  // as well as half a step down, and the row above has to know it.
  const deep = new Map<string, number>();
  for (const [cwd, held] of open) deep.set(cwd, held.length);

  const prepared = new Map(
    workspace.repositories.map((repository) => [
      repository.id,
      prepare(repository, visible.get(repository.id), deep),
    ]),
  );

  // Only the bands and the column are ever asked for: a commit node comes back
  // from the repository's own cached layout, already the object it was drawn
  // from. The commits outnumber those by three orders of magnitude, so indexing
  // them here would be the most expensive part of a rebuild that changes
  // nothing.
  const before = new Map<string, Held>();
  for (const node of previous?.nodes ?? []) {
    if (
      node.type === "repository" ||
      node.type === "folder" ||
      node.type === "repo-mark" ||
      node.type === "cli" ||
      node.type === "ask" ||
      node.type === "report"
    ) {
      before.set(node.id, node);
    }
  }

  const nodes: AppNode[] = [];
  const bands: Band[] = [];
  /** The lines that are nobody's band: what a folder holds, and what runs in it. */
  const links: GraphLine[] = [];
  const groups = new Map<string, Group>();
  const draw: Draw = { before };
  /**
   * What a row has already taken for its own stack.
   *
   * A terminal stands in one place and no other, and the rows go down in order
   * — so the first row that draws the directory a terminal is working in keeps
   * it. A directory two repositories both draw, or a folder opened straight
   * onto a repository, is the whole of why this is needed.
   */
  const claimed = new Set<string>();

  /** How far down and how far along what has been laid out reaches. */
  let bottom = 0;
  let right = 0;
  /**
   * Where the next folder that has not been carried anywhere is laid out.
   *
   * Kept apart from `bottom`, which is how far what is drawn actually reaches:
   * a group that was dragged somewhere else still holds the slot it was given,
   * so moving one folder moves nothing else and putting it back puts it back.
   */
  let flowed = 0;

  // One column per folder, down the canvas. A folder is the unit somebody put
  // on the graph, so it is the unit the canvas is arranged in — and a
  // repository never has to be looked for somewhere other than under the folder
  // it came through.
  for (const folder of folders) {
    const held = folder.repositories
      .map((id) => prepared.get(id))
      .filter((entry) => entry !== undefined);

    const at = { x: 0, y: flowed };
    const moved = places.get(folder.root);
    const group = folderGroup(
      { folder, held, opened, open, showing, asks, reports, reaching },
      { x: at.x + (moved?.x ?? 0), y: at.y + (moved?.y ?? 0) },
      claimed,
      draw,
    );

    nodes.push(...group.nodes);
    bands.push(...group.bands);
    links.push(...group.links);
    groups.set(folder.root, { node: folderId(folder.root), at, members: group.members });

    right = Math.max(right, group.right);
    bottom = Math.max(bottom, group.bottom);
    flowed += group.height + REPO_GAP_Y;
  }

  return {
    nodes,
    bands,
    groups,
    reach: batched(links),
    // Room for what hangs off the far edge of a band: the offer the cursor
    // draws is a cell past the commit it comes out of.
    extent: { width: right + STEP.x, height: bottom + STEP.y },
  };
}

/** One folder laid out, and everything the canvas needs to know about it. */
type LaidGroup = {
  nodes: AppNode[];
  bands: Band[];
  /** Its own lines, in canvas coordinates: what it holds, and what is running. */
  links: GraphLine[];
  /** Everything that travels with the folder — see `Group`. */
  members: string[];
  /** How far what is drawn for it reaches, cards and all. */
  right: number;
  bottom: number;
  /**
   * How tall the group is, which is the room the next folder is laid out after.
   *
   * The rows and nothing else. A question standing beside a terminal is several
   * rows deep and comes and goes with the asking, and a canvas that reflowed
   * every folder under it each time an agent spoke would be a canvas nobody
   * could read while anything was running.
   */
  height: number;
};

/**
 * One folder: its row, then the repositories it holds, one to a row, each of
 * them joined back to the folder's own mark.
 *
 * The column is the whole of the arrangement. A repository that is folded away
 * is one row holding a name and a ring; one that is opened out is a band of its
 * own history standing in the same column, at the same inset, with its name in
 * the same place — so opening it changes what is in the row and pushes what is
 * under it down, and nothing moves sideways at all.
 *
 * What is running is settled before anything is placed, because a stack is
 * centred on its row's own line and therefore reaches up into the row above as
 * well as down into the row below: how far apart two rows stand is a sum over
 * both of their stacks, and neither of them can be put anywhere until both are
 * known. See `rowPitch`.
 *
 * `at` is where the group stands, which is where it was laid out plus however
 * far it has been carried. Everything below is measured from it, so a group
 * that has been dragged is the same group drawn somewhere else.
 */
function folderGroup(
  input: {
    folder: Folder;
    /** The repositories in it, in the folder's own order. */
    held: readonly PreparedRepository[];
    opened: ReadonlyMap<string, boolean>;
    open: ReadonlyMap<string, Session[]>;
    showing: string | null;
    asks: ReadonlyMap<string, Ask>;
    reports: ReadonlyMap<string, Report>;
    reaching: string | null;
  },
  at: { x: number; y: number },
  claimed: Set<string>,
  draw: Draw,
): LaidGroup {
  const { folder, held, opened, open, showing, asks, reports, reaching } = input;
  const drawn: LaidGroup = {
    nodes: [],
    bands: [],
    links: [],
    members: [],
    right: at.x + FOLDER_ROW_WIDTH,
    bottom: at.y + LANE_HEIGHT,
    height: LANE_HEIGHT,
  };

  const id = folderId(folder.root);
  const shown = held.filter((entry) => isOpen(opened, entry.repository.id, held.length));
  drawn.nodes.push(folderRow(folder.root, folder.name, shown.length === held.length, at, draw));

  // Where every line the folder draws leaves from: its own mark, which is the
  // one thing on the row that is the folder itself.
  const from = inBand(id, FOLDER_MARK_X + FOLDER_MARK / 2, LANE_HEIGHT / 2);

  // What is running in the folder itself. Only what no repository in it answers
  // for: a folder opened straight onto a repository is one directory with two
  // rows drawn for it, and the repository is the row that says what is going on
  // in there.
  const inside = new Set<string>();
  for (const entry of held) {
    inside.add(entry.repository.path);
    for (const worktree of entry.repository.worktrees) inside.add(worktree.path);
  }
  const running = inside.has(folder.root) ? [] : take(open, claimed, [folder.root]);

  // And what is running in each of them, claimed in the order the rows are read
  // down the column. A band takes the terminals of every branch it draws and
  // stacks them inside itself; a folded repository takes everything working
  // anywhere in it, because its ring is the whole of what is drawn for it.
  const rows: Row[] = held.map((entry) =>
    shown.includes(entry)
      ? { entry, column: bandColumn(entry, open, claimed, showing, asks, reports, draw) }
      : {
          entry,
          standing: take(open, claimed, [
            entry.repository.path,
            ...entry.repository.worktrees.map((worktree) => worktree.path),
          ]),
        },
  );

  /**
   * How far down the last card in this group reached.
   *
   * The cards stand in one column of their own, past the rows: two questions
   * asked at once are two cards in that column, and a card is several times the
   * height of the mark it belongs to. So each is set beside its own terminal
   * where there is room and pushed down past the last where there is not.
   */
  let floor = Number.NEGATIVE_INFINITY;

  const beside = rowStack(
    running,
    {
      open,
      // Past the last of the row's buttons rather than on any of them: the row
      // is the place, and there is no mark on it that is the directory.
      socket: inBand(id, FOLDER_ROW_WIDTH, LANE_HEIGHT / 2),
      lead: REACH_TRIM,
      at: { x: at.x + FOLDER_ROW_WIDTH + CHIP_STEP - SESSION_WIDTH / 2, y: at.y + LANE_HEIGHT / 2 },
      showing,
      asks,
      reports,
      floor,
    },
    draw,
  );
  merge(beside, drawn);
  floor = beside.floor;

  const x = at.x + FOLDER_INSET;
  /** How far down the group reaches so far, which is what the next row clears. */
  let cursor = at.y + LANE_HEIGHT / 2 + rowReach(running.length);
  /** The line of the row above and what it is running, while there is one. */
  let above: { line: number; marks: number } | null = {
    line: at.y + LANE_HEIGHT / 2,
    marks: running.length,
  };
  /** Whether the next row is the first under the folder's own row. */
  let first = true;

  for (const row of rows) {
    const entry = row.entry;
    /**
     * The air above this row.
     *
     * A column of folded repositories is a list and runs one row straight after
     * another — a row apiece is already a row of air between two names. A band
     * is a repository opened out and stands clear of whatever it is between, so
     * that the eye can tell where one history stops and the next begins. And
     * the first row of the lot is set under the folder by the group's own
     * inset, which is what says the column belongs to that folder.
     */
    const air = first ? FOLDER_GAP_Y : "column" in row || above === null ? REPO_GAP_Y : 0;
    first = false;

    if ("column" in row) {
      // A band is a box rather than a line, and it holds its own stacks: the
      // layout has already spaced its branches for what is running in them, so
      // the room a repository opened out takes is the room it says it takes.
      const top = cursor + air;
      const width = entry.style.width;
      const proposed = entry.repository.id === reaching;
      drawn.nodes.push(repositoryNode(entry, x, top, width, draw.before.get(entry.repository.id)));
      drawn.nodes.push(...(proposed ? provisional(entry.nodes) : entry.nodes));
      drawn.nodes.push(...row.column.nodes);
      drawn.members.push(entry.repository.id);

      // The lines come back as the band laid them out, in its own coordinates:
      // the band carries where it stands, so moving a repository is a different
      // transform on the same paths rather than a redrawn repository.
      drawn.bands.push({
        id: entry.repository.id,
        x,
        y: top,
        width,
        height: entry.style.height,
        lines: entry.lines,
        runs: batched(row.column.lines),
        provisional: proposed,
      });

      // At the name, which is where a band begins. The same end as a folded
      // repository's, one row of the same column further down.
      drawn.links.push(
        holds(id, from, entry.repository.id, {
          node: entry.repository.id,
          dx: entry.data.label.x,
          dy: entry.data.label.y + LANE_HEIGHT / 2,
        }),
      );

      // A column deeper than the band it belongs to is what the canvas has to
      // make room for; the band itself is the history's own height. A question
      // standing beside a terminal reaches past the band either way, and is
      // room the canvas has to hold without the band being widened for it.
      drawn.right = Math.max(drawn.right, x + Math.max(width, row.column.right));
      drawn.bottom = Math.max(drawn.bottom, top + Math.max(entry.style.height, row.column.bottom));
      cursor = top + entry.style.height;
      above = null;
      continue;
    }

    const marks = row.standing.length;
    // A row under another row stands the pitch of the two of them below it; one
    // under a band stands clear of the band's own box.
    // Annotated because the row below reads it back off `above`, and a type
    // worked out from that would be a type worked out from itself.
    const line: number =
      above === null
        ? cursor + air + rowReach(marks)
        : above.line + rowPitch(above.marks, marks) + air;
    const top = line - LANE_HEIGHT / 2;

    const mark = markId(id, entry.repository);
    drawn.nodes.push(repoMark(id, entry.repository, { x, y: top }, draw));
    drawn.members.push(mark);
    drawn.links.push(
      holds(id, from, entry.repository.id, { node: mark, dx: 0, dy: LANE_HEIGHT / 2 }),
    );

    // Everything working anywhere in it stands beside its ring: the repository
    // is one mark now, so its own checkout and every worktree cut from it end
    // in the same place. Folding a repository away moves where a terminal is
    // drawn and never whether it is drawn.
    const stack = rowStack(
      row.standing,
      {
        open,
        socket: { node: mark, dx: REPO_MARK_WIDTH - REPO_MARK_RING, dy: LANE_HEIGHT / 2 },
        lead: RING_TRIM,
        at: {
          x: x + REPO_MARK_WIDTH - REPO_MARK_RING + CHIP_STEP - SESSION_WIDTH / 2,
          y: line,
        },
        showing,
        asks,
        reports,
        floor,
      },
      draw,
    );
    merge(stack, drawn);
    floor = stack.floor;

    drawn.right = Math.max(drawn.right, x + REPO_MARK_WIDTH, stack.right);
    cursor = line + rowReach(marks);
    above = { line, marks };
  }

  drawn.height = cursor - at.y;
  drawn.bottom = Math.max(drawn.bottom, cursor, floor);
  return drawn;
}

/**
 * One row of a folder's column, and what it has running in it.
 *
 * A band stacks its terminals on the branches it draws, so what it is running
 * is already inside it; a folded repository has one ring and everything working
 * in it stands beside that.
 */
type Row =
  | { entry: PreparedRepository; column: Column }
  | { entry: PreparedRepository; standing: Session[] };

/** One line from a folder's mark to something it holds. */
function holds(band: string, from: LineEnd, repository: string, to: LineEnd): GraphLine {
  return {
    id: `${band}holds${repository}`,
    from,
    to,
    curve: true,
    trim: REACH_TRIM,
    lead: FOLDER_MARK / 2,
    stroke: FOLDER_STROKE,
  };
}

/**
 * The terminals running in one directory, taken out of what is still going
 * spare.
 *
 * A terminal is drawn once. Which row draws it is settled by whichever asks
 * first, and the rows are asked in the order they are read down the canvas.
 */
function take(
  open: ReadonlyMap<string, Session[]>,
  claimed: Set<string>,
  /** Every directory this row answers for, in the order they are stacked. */
  home: readonly string[],
): Session[] {
  const standing: Session[] = [];
  for (const place of home) {
    for (const session of open.get(place) ?? []) {
      if (claimed.has(session.id)) continue;
      claimed.add(session.id);
      standing.push(session);
    }
  }
  return standing;
}

/** One row's terminals, and what they cost the row they stand beside. */
type RowStack = {
  nodes: AppNode[];
  /** The lines back to the row, in canvas coordinates. */
  lines: GraphLine[];
  /** How many are standing there, which is the room the row has to ask for. */
  marks: number;
  right: number;
  bottom: number;
  /** How far down the last card reached, for the next row to stand clear of. */
  floor: number;
};

/**
 * What is running in one directory, stacked beside the row that draws it.
 *
 * The same stack a branch carries, hung on a row that is not a branch: a folder
 * itself, or a repository folded into a single mark. Oldest first, a `CLI_STEP`
 * apart, and centred on the row's own line rather than trailing under it — a
 * row is one place, and everything running in it belongs to that place equally.
 *
 * The row is what makes the room for it: nothing under a folder's own row has
 * been spaced by a layout, so a stack of three pushes the repositories below it
 * down by exactly what it reaches. See `stackRoom`.
 */
function rowStack(
  standing: readonly Session[],
  where: {
    open: ReadonlyMap<string, Session[]>;
    /** Where a line from one of these lands: the row's mark, or its far end. */
    socket: LineEnd;
    /** How far out from that end its line starts, which is half of any mark. */
    lead: number;
    /** The stack's own column, and the line of the row it hangs on. */
    at: { x: number; y: number };
    showing: string | null;
    asks: ReadonlyMap<string, Ask>;
    reports: ReadonlyMap<string, Report>;
    floor: number;
  },
  draw: Draw,
): RowStack {
  const { open, socket, lead, at, showing, asks, reports } = where;
  const drawn: RowStack = {
    nodes: [],
    lines: [],
    marks: standing.length,
    right: at.x,
    bottom: at.y,
    floor: where.floor,
  };
  if (standing.length === 0) return drawn;

  // Where the top of the stack goes: half of it above the row's own line and
  // half below, so it opens out either way as it grows.
  const head = at.y - stackReach(standing.length) - CLI_STEP / 2;

  for (const [slot, session] of standing.entries()) {
    const id = `session${session.id}`;
    const y = head + slot * CLI_STEP;

    drawn.nodes.push(
      cliNode(
        id,
        {
          session,
          showing: session.id === showing,
          ordinal: ordinalOf(open.get(session.cwd) ?? [], session),
        },
        null,
        at.x,
        y,
        draw,
      ),
    );

    drawn.lines.push({
      id: `${id}run`,
      from: socket,
      to: onStack(id),
      curve: true,
      // Half the glyph it arrives at, so the line stops beside the terminal
      // rather than being drawn across it.
      trim: CLI_MARK / 2,
      lead,
      stroke: CLI_STROKE,
    });

    drawn.right = Math.max(drawn.right, at.x + SESSION_WIDTH);
    drawn.bottom = Math.max(drawn.bottom, y + CLI_STEP);

    // And whatever it has standing beside it: the one thing out here that is
    // words rather than a mark.
    const x = at.x + SESSION_WIDTH + ASK_GAP;
    const card = besideMark(session, asks, reports, id, null, x, y, drawn.floor, draw);
    if (!card) continue;

    drawn.floor = card.at + card.height + ASK_STACK_GAP;
    drawn.nodes.push(card.node);
    drawn.lines.push(card.line);
    drawn.right = Math.max(drawn.right, x + ASK_WIDTH);
    drawn.bottom = Math.max(drawn.bottom, card.at + card.height);
  }

  return drawn;
}

/** One row's stack, folded into the group it was drawn for. */
function merge(stack: RowStack, drawn: LaidGroup) {
  drawn.nodes.push(...stack.nodes);
  drawn.links.push(...stack.lines);
  // Every mark out here stands on the canvas in its own right, so every one of
  // them is carried by hand when the folder is.
  for (const node of stack.nodes) drawn.members.push(node.id);
  drawn.right = Math.max(drawn.right, stack.right);
  drawn.bottom = Math.max(drawn.bottom, stack.bottom);
}

/**
 * A band's own nodes, marked as being proposed rather than shown.
 *
 * Copied here rather than laid out that way, because the layout is cached per
 * repository and per depth and a pull passes through depths it may well come
 * back to — a cache holding a flag that belongs to one moment of one gesture
 * would hand it back long after the hand had gone.
 *
 * Only the branches carry it. A commit is drawn in the band's own SVG, which
 * is told about the pull once, as a class on the group the whole band is in.
 */
function provisional(nodes: PreparedRepository["nodes"]): PreparedRepository["nodes"] {
  return nodes.map((node) =>
    node.type === "head" ? { ...node, data: { ...node.data, provisional: true } } : node,
  );
}

/**
 * How far short of a row a line into it stops.
 *
 * A hair, so that the line arrives at the row rather than under whatever is
 * standing at that end of it: the folder's own line stops just before the name
 * it is pointing at, and a terminal's just past the last of its row's buttons.
 */
const REACH_TRIM = 4;

/** What a repository's branches hold beside them. */
type Column = {
  nodes: AppNode[];
  /** The lines joining each branch to its own stack, in band coordinates. */
  lines: GraphLine[];
  /** How far down the band the stacks reach, which the canvas is measured by. */
  bottom: number;
  /**
   * And how far along, which is only ever a question standing beside a mark.
   *
   * The band's own width holds its history and its terminals, and a card is
   * neither: it comes and goes with a question, and the room for it cannot be
   * held open in the band or every repository would carry an empty corridor
   * for a thing that is almost never there.
   */
  right: number;
};

/**
 * One repository's terminals, stacked on the branch each of them is working in.
 *
 * A stack is read downwards: what is running, oldest first — and it is centred
 * on the branch's own line rather than hung under it, so it opens out either
 * way as it grows. A branch running nothing has no stack, because the offer of
 * a terminal is the button on its ring rather than a mark held open out here.
 * The list is packed a `CLI_STEP` at a time rather than a row of the grid
 * apiece — a row is what two lines of development need to be told apart, and
 * terminals are not lines of development — and the layout has already pushed
 * the branches below far enough down to hold it.
 *
 * Built here rather than in the layout because which terminals are running is
 * not history: one opening changes nothing but its own branch's stack, and the
 * repository it belongs to is handed back exactly as it was drawn.
 */
function bandColumn(
  entry: PreparedRepository,
  open: ReadonlyMap<string, Session[]>,
  /** What another row has already taken, so that nothing is drawn twice. */
  claimed: Set<string>,
  showing: string | null,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
  draw: Draw,
): Column {
  const band = entry.repository.id;
  const drawn: Column = { nodes: [], lines: [], bottom: 0, right: 0 };
  /**
   * How far down the last card in this band reached.
   *
   * Cards stand in one column of their own, to the right of every stack, so two
   * branches asked at once are two cards in the same column — and a card is
   * several times the height of the mark it belongs to. So each one is set
   * beside its own terminal wherever there is room, and pushed down past the
   * last one where there is not: a question that has been shoved down the
   * canvas is still readable, and two drawn over each other are not.
   */
  let floor = Number.NEGATIVE_INFINITY;

  for (const run of entry.runs) {
    const cwd = run.cwd;
    // Two refs can point at one directory — a branch and the worktree it is
    // checked out in — and a directory can be somewhere two repositories both
    // draw. The first claim keeps it; drawing it twice would hand React Flow
    // one id twice.
    const standing = cwd ? take(open, claimed, [cwd]) : [];

    // Where the top of the stack goes: the marks that are running, hung on the
    // branch's own line with half of them above it and half below. A branch is
    // one place and everything running in it is that place's, so the stack
    // opens out from the branch rather than trailing under it — and the layout
    // has made the room either side.
    const head = run.y - stackReach(standing.length);

    // The terminals that are running, oldest first, and nothing else: a branch
    // with none of them draws nothing here.
    for (const [slot, session] of standing.entries()) {
      const id = `session${session.id}`;
      const y = head + slot * CLI_STEP;

      drawn.nodes.push(
        cliNode(
          id,
          {
            session,
            showing: session.id === showing,
            ordinal: ordinalOf(open.get(session.cwd) ?? [], session),
          },
          band,
          run.x,
          y,
          draw,
        ),
      );

      drawn.lines.push({
        id: `${id}run`,
        from: onCell(run.head),
        to: onStack(id),
        curve: true,
        // Half the glyph it arrives at, so the line stops beside the terminal
        // rather than being drawn across it. There is no paper under the mark
        // to hide a line that went too far.
        trim: CLI_MARK / 2,
        lead: RING_TRIM,
        stroke: CLI_STROKE,
      });

      drawn.bottom = Math.max(drawn.bottom, y + CLI_STEP);

      // And whatever it has standing beside it: the one thing out here that is
      // words rather than a mark.
      const x = run.x + SESSION_WIDTH + ASK_GAP;
      const beside = besideMark(session, asks, reports, id, band, x, y, floor, draw);
      if (!beside) continue;

      floor = beside.at + beside.height + ASK_STACK_GAP;
      drawn.nodes.push(beside.node);
      drawn.lines.push(beside.line);

      drawn.bottom = Math.max(drawn.bottom, beside.at + beside.height);
      drawn.right = Math.max(drawn.right, x + ASK_WIDTH);
    }
  }

  return drawn;
}

/**
 * The line from a terminal to the question it is standing on.
 *
 * Drawn the same way as the line from the branch to the terminal: this is the
 * same piece of work, one step further along. What it does that the card cannot
 * is say which of a stack of terminals is the one being asked — a card set
 * beside a column of marks belongs to none of them until a line says so.
 */
function cardLine(card: string, mark: string, height: number): GraphLine {
  return {
    id: `${card}line`,
    from: onStack(mark),
    to: { node: card, dx: 0, dy: height / 2 },
    curve: true,
    trim: 0,
    lead: CLI_MARK / 2,
    stroke: CLI_STROKE,
  };
}

/**
 * One question's card, handed back unchanged where it can be.
 *
 * The same holding-on every other node here does, and it matters more for this
 * one than for most: a question is redrawn whenever the terminal under it says
 * anything at all, and a card rebuilt each time would be a card whose buttons
 * were new objects under a pointer that was already on one of them.
 */
function askNode(
  id: string,
  data: AskNodeData,
  band: string | null,
  x: number,
  y: number,
  draw: Draw,
): AskFlowNode {
  const held = draw.before.get(id);
  if (
    held?.type === "ask" &&
    held.data.session === data.session &&
    held.data.ask === data.ask &&
    (held.parentId ?? null) === band &&
    held.position.x === x &&
    held.position.y === y
  ) {
    return held;
  }

  return {
    id,
    type: "ask",
    ...(band === null ? null : { parentId: band }),
    position: { x, y },
    data,
    style: { width: ASK_WIDTH, height: data.card.height },
    zIndex: ASK_Z,
    draggable: false,
    selectable: false,
  };
}

/**
 * What a terminal has standing beside it, and where.
 *
 * Two things can be there and only ever one of them at a time: the question the
 * session has stopped to ask, and — where nothing is waiting — what it says it
 * is working on. The question wins, and not because it is newer. A question is
 * a turn nobody has taken, nothing else happens in that session until it is
 * answered, and what the agent said it was doing a moment before it stopped to
 * ask is the less useful of the two things it could be saying.
 *
 * `floor` is how far down the last card in this column reached. A card is
 * several times the height of the mark it belongs to, so each one is set beside
 * its own terminal wherever there is room and pushed down past the last one
 * where there is not: a card shoved down the canvas is still readable, and two
 * drawn over each other are not.
 */
function besideMark(
  session: Session,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
  /** The terminal mark it belongs to, which its line comes out of. */
  mark: string,
  band: string | null,
  x: number,
  y: number,
  floor: number,
  draw: Draw,
): { node: AppNode; line: GraphLine; at: number; height: number } | null {
  /** Beside its own terminal, or under whatever was drawn last. */
  const place = (height: number) => Math.max(y + CLI_STEP / 2 - height / 2, floor);

  const asking = asks.get(session.id);
  if (asking) {
    const id = `ask${session.id}`;
    const card = askCard(asking);
    const at = place(card.height);
    return {
      node: askNode(id, { session, ask: asking, card }, band, x, at, draw),
      line: cardLine(id, mark, card.height),
      at,
      height: card.height,
    };
  }

  const said = reports.get(session.id);
  if (!said) return null;

  const id = `report${session.id}`;
  const card = reportCard(said);
  const at = place(card.height);
  return {
    node: reportNode(id, { session, report: said, card }, band, x, at, draw),
    line: cardLine(id, mark, card.height),
    at,
    height: card.height,
  };
}

/**
 * One report's card, handed back unchanged where it can be.
 *
 * The same holding-on as a question's, and for a gentler version of the same
 * reason: a report changes when the agent says something new rather than
 * whenever the terminal draws, but the graph around it is rebuilt for every
 * commit, every fold and every keystroke in a session — and a card rebuilt each
 * of those times is a card React Flow has to place again.
 */
function reportNode(
  id: string,
  data: ReportNodeData,
  band: string | null,
  x: number,
  y: number,
  draw: Draw,
): ReportFlowNode {
  const held = draw.before.get(id);
  if (
    held?.type === "report" &&
    held.data.session === data.session &&
    held.data.report === data.report &&
    (held.parentId ?? null) === band &&
    held.position.x === x &&
    held.position.y === y
  ) {
    return held;
  }

  return {
    id,
    type: "report",
    ...(band === null ? null : { parentId: band }),
    position: { x, y },
    data,
    style: { width: ASK_WIDTH, height: data.card.height },
    zIndex: ASK_Z,
    draggable: false,
    selectable: false,
  };
}

/**
 * The lines by how they are drawn, so that every line of one kind is a single
 * path.
 *
 * The same batching a band does with its history, for the same reason: a canvas
 * with a score of terminals on it should cost the engine a handful of elements.
 */
function batched(lines: readonly GraphLine[]): GraphResult["reach"] {
  const batches = new Map<string, { key: string; stroke: StrokeStyle; parts: GraphLine[] }>();
  for (const line of lines) {
    const key = `${line.stroke.colour}|${line.stroke.width}|${line.stroke.opacity}|${line.stroke.dash ?? ""}`;
    const held = batches.get(key);
    if (held) {
      held.parts.push(line);
      continue;
    }
    batches.set(key, { key, stroke: line.stroke, parts: [line] });
  }
  return [...batches.values()];
}

/**
 * One terminal's mark, handed back unchanged where it can be.
 *
 * `band` is the repository whose branch it is standing under, and null for one
 * standing beside a folder's own row or a folded repository's mark — where it
 * goes when the canvas draws no branch for the directory it is running in. The
 * position is read against whichever of the two it is, so moving between them
 * is a node that changed rather than two nodes.
 *
 * Held on to across a rebuild: the graph is rebuilt whenever anything on it
 * moves, and a terminal that did not move is the same object it was — so its
 * mark is the one React Flow already has, rather than an equal copy it has to
 * take down and put up again.
 */
function cliNode(
  id: string,
  data: CliNodeData,
  band: string | null,
  x: number,
  y: number,
  draw: Draw,
): CliFlowNode {
  const held = draw.before.get(id);
  if (
    held?.type === "cli" &&
    held.data.session === data.session &&
    held.data.showing === data.showing &&
    held.data.ordinal === data.ordinal &&
    (held.parentId ?? null) === band &&
    held.position.x === x &&
    held.position.y === y
  ) {
    return held;
  }

  return {
    id,
    type: "cli",
    ...(band === null ? null : { parentId: band }),
    position: { x, y },
    data,
    style: STACK_STYLE,
    draggable: false,
    selectable: false,
  };
}

/** The band itself: the backdrop a repository's own nodes are placed inside. */
function repositoryNode(
  entry: PreparedRepository,
  x: number,
  y: number,
  width: number,
  before: AppNode | undefined,
): RepositoryFlowNode {
  if (
    before?.type === "repository" &&
    before.data === entry.data &&
    before.position.x === x &&
    before.position.y === y &&
    before.style?.width === width
  ) {
    return before;
  }

  return {
    id: entry.repository.id,
    type: "repository",
    position: { x, y },
    data: entry.data,
    draggable: false,
    selectable: false,
    // A band is a backdrop the width of a repository; taking the pointer would
    // mean no dragging the canvas anywhere history is drawn.
    style: { width, height: entry.style.height, pointerEvents: "none" },
  };
}
