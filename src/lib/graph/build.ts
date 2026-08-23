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
import { folderRow, isOpen } from "./folders";
import { type PreparedRepository, prepare } from "./layout";
import {
  type AppNode,
  type Band,
  CLI_MARK,
  CLI_STEP,
  CLI_STROKE,
  type CliFlowNode,
  type CliNodeData,
  type Draw,
  FOLDER_GAP_Y,
  FOLDER_INSET,
  type FolderFlowNode,
  type GraphLine,
  type GraphResult,
  inBand,
  LANE_HEIGHT,
  type LineEnd,
  onCell,
  onStack,
  REPO_GAP_X,
  REPO_GAP_Y,
  type RepoMarkFlowNode,
  type RepositoryFlowNode,
  RING_TRIM,
  SESSION_WIDTH,
  STACK_STYLE,
  STACK_TOP,
  STEP,
  type StrokeStyle,
  stackReach,
  TARGET_ASPECT,
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
 * The canvas: every repository the workspace holds, laid beside one another,
 * with what is running in each branch stacked straight down from that branch.
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
 * This window's own terminals and nothing else. One somebody opened somewhere
 * else cannot be shown in the panel, typed into or ended from here — a pty
 * belongs to the process that made it — and a mark that answers to none of
 * those is a list entry rather than a thing on a canvas.
 *
 * The one place that is not a branch's is the last column: a terminal working
 * somewhere no band on the canvas draws — in a folder itself, or in a
 * repository that is folded into a mark — stands past the whole canvas
 * instead, where its line can still reach whatever is drawn for it.
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
};

export function buildCommitGraph(
  { workspace, folders, visible, opened, sessions, showing, asks, reports, reaching }: GraphInput,
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
  const draw: Draw = { before, rows: new Map() };
  /**
   * What a band has already taken into its own column.
   *
   * A terminal stands in one column and no other, and the bands go down in
   * order — so the first repository that draws the branch a terminal is working
   * in keeps it, and the last column takes whatever is left.
   */
  const claimed = new Set<string>();

  /** How far down and how far along what has been laid out reaches. */
  let bottom = 0;
  let right = 0;

  // One group per folder, down the canvas: the folder's own row, then whatever
  // in it has been opened out, packed underneath and set in from the row. A
  // folder is the unit somebody put on the graph, so it is the unit the canvas
  // is arranged in — and a repository opened out never has to be looked for
  // somewhere other than under the folder it came through.
  for (const folder of folders) {
    const held = folder.repositories
      .map((id) => prepared.get(id))
      .filter((entry) => entry !== undefined);
    const shown = held.filter((entry) => isOpen(opened, entry.repository.id, held.length));

    const row = folderRow(
      folder.root,
      folder.name,
      held.filter((entry) => !shown.includes(entry)).map((entry) => entry.repository),
      shown.length === held.length,
      { x: 0, y: bottom },
      draw,
    );
    nodes.push(...row.nodes);
    right = Math.max(right, row.width);

    // Where the bands under this row begin, which is what the packing inside it
    // is measured from — and what a band already standing there is measured
    // against, so that folding history away still moves nothing but the fold.
    const origin = { x: FOLDER_INSET, y: bottom + LANE_HEIGHT + FOLDER_GAP_Y };
    const was = before.get(`folder${folder.root}`);
    const held0 =
      was?.type === "folder"
        ? { x: was.position.x + FOLDER_INSET, y: was.position.y + LANE_HEIGHT + FOLDER_GAP_Y }
        : undefined;

    let reach = bottom + LANE_HEIGHT;
    // A band is as wide as its own three parts, the column of terminals
    // included: that column is part of the repository whether or not anything
    // is standing in it, so opening a terminal moves nothing beside it.
    const measured = shown.map((entry) => ({ entry, width: entry.style.width }));
    for (const { entry, width, x, y } of settle(measured, before, held0)) {
      const at = { x: origin.x + x, y: origin.y + y };
      reach = Math.max(reach, at.y + entry.style.height);
      right = Math.max(right, at.x + width);
      const proposed = entry.repository.id === reaching;
      nodes.push(repositoryNode(entry, at.x, at.y, width, before.get(entry.repository.id)));
      nodes.push(...(proposed ? provisional(entry.nodes) : entry.nodes));

      // What is running in this repository, stacked in its own column.
      const drawn = bandColumn(entry, open, claimed, showing, asks, reports, draw);
      nodes.push(...drawn.nodes);
      // A column deeper than the band it belongs to is what the canvas has to
      // make room for; the band itself is the history's own height. A question
      // standing beside a terminal reaches past the band either way, and is
      // room the canvas has to hold without the band being widened for it.
      reach = Math.max(reach, at.y + drawn.bottom);
      right = Math.max(right, at.x + drawn.right);

      // The lines come back as the band laid them out, in its own coordinates:
      // the band carries where it stands, so moving a repository is a different
      // transform on the same paths rather than a redrawn repository.
      bands.push({
        id: entry.repository.id,
        x: at.x,
        y: at.y,
        width,
        height: entry.style.height,
        lines: entry.lines,
        runs: batched(drawn.lines),
        provisional: proposed,
      });
    }

    bottom = reach + REPO_GAP_Y;
  }
  // The gap after the last folder is not part of what was drawn.
  if (folders.length > 0) bottom -= REPO_GAP_Y;

  // Past the whole of it, so that a terminal no repository claimed is never
  // mistaken for something standing in one, and every line out of this column
  // crosses into the history rather than starting inside it.
  const column = cliColumn(
    sessions.filter((session) => !claimed.has(session.id)),
    open,
    showing,
    asks,
    reports,
    right === 0 ? 0 : right + REPO_GAP_X,
    draw,
  );
  nodes.push(...column.nodes);
  right = Math.max(right, column.right);
  bottom = Math.max(bottom, column.bottom);

  return {
    nodes,
    bands,
    reach: batched(column.reach),
    // Room for what hangs off the far edge of a band: the offer the cursor
    // draws is a cell past the commit it comes out of.
    extent: { width: right + STEP.x, height: bottom + STEP.y },
  };
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
 * How far short of a row's end a line into it stops.
 *
 * A hair, so that the line arrives at the row rather than under the last of its
 * buttons — and so that a row with nothing else on it still reads as the place
 * the line was drawn to.
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
  /** What another band has already taken, so that nothing is drawn twice. */
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
    const standing: Session[] = [];

    if (cwd) {
      // Where a line into this checkout lands, from anywhere on the canvas: the
      // branch itself, which is what work happening in a directory is work on.
      draw.rows.set(cwd, inBand(band, run.at.x, run.at.y));

      // Two refs can point at one directory — a branch and the worktree it is
      // checked out in — and a directory can be somewhere two repositories both
      // draw. The first claim keeps it; drawing it twice would hand React Flow
      // one id twice.
      for (const session of open.get(cwd) ?? []) {
        if (claimed.has(session.id)) continue;
        claimed.add(session.id);
        standing.push(session);
      }
    }

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
 * The terminals no repository claimed, in the last column of the canvas.
 *
 * A terminal belongs in the column of the repository whose branch it is working
 * in. One working in a folder itself, or in a repository that is folded into a
 * mark, has no such column — so it stands past the whole canvas instead, where
 * its line can still reach the folder row or the mark that is drawn for it.
 *
 * In the order they were opened, like a stack in a band: a terminal that is
 * still running keeps its place in the column while the ones around it come and
 * go.
 */
function cliColumn(
  sessions: readonly Session[],
  open: ReadonlyMap<string, Session[]>,
  showing: string | null,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
  x: number,
  draw: Draw,
): { nodes: AppNode[]; reach: GraphLine[]; right: number; bottom: number } {
  const nodes: AppNode[] = [];
  const lines: GraphLine[] = [];
  /** The lines from a terminal out here to the card beside it. */
  const cards: GraphLine[] = [];
  /** How far down and along the cards in this column have reached. */
  let floor = Number.NEGATIVE_INFINITY;
  let widest = 0;

  let index = 0;
  for (const session of sessions) {
    const id = `session${session.id}`;
    const y = STACK_TOP + index * CLI_STEP;
    const drawn = reachLine(id, onStack(id), session.cwd, CLI_MARK / 2, draw);
    // Nothing on the canvas to join it to, so it is not on the canvas. Closing
    // a repository is about the graph and nothing else — what was running in it
    // carries on running, and putting the folder back brings the whole column
    // back with its terminals still in it.
    if (!drawn) continue;

    nodes.push(
      cliNode(
        id,
        {
          session,
          showing: session.id === showing,
          ordinal: ordinalOf(open.get(session.cwd) ?? [], session),
        },
        null,
        x,
        y,
        draw,
      ),
    );
    lines.push(drawn);

    // And whatever it has standing beside it, the same as in a band.
    const beside = besideMark(
      session,
      asks,
      reports,
      id,
      null,
      x + SESSION_WIDTH + ASK_GAP,
      y,
      floor,
      draw,
    );
    if (beside) {
      floor = beside.at + beside.height + ASK_STACK_GAP;
      nodes.push(beside.node);
      cards.push(beside.line);
      widest = Math.max(widest, SESSION_WIDTH + ASK_GAP + ASK_WIDTH);
    }

    index += 1;
  }

  return {
    nodes,
    // The cards' own lines go with them: both ends are out on the canvas here,
    // the way everything in this column is.
    reach: [...lines, ...cards],
    right: index === 0 ? 0 : x + Math.max(SESSION_WIDTH, widest),
    bottom: index === 0 ? 0 : Math.max(STACK_TOP + index * CLI_STEP, floor),
  };
}

/**
 * The line out of a terminal in the last column, to the directory it is running
 * in — when the graph is drawing that directory at all.
 *
 * Nothing is what says a terminal out here has no business being on this
 * canvas: it is working somewhere none of the folders on the graph reach, and a
 * mark with no line is a list entry rather than a place.
 */
function reachLine(
  node: string,
  from: LineEnd,
  place: string,
  /** Half the mark it leaves, so that it is not drawn inside it. */
  lead: number,
  draw: Draw,
): GraphLine | null {
  const to = draw.rows.get(place);
  // The directory is not one the graph was opened on. A line to nothing is
  // worse than the absence of one, and the absence is the whole answer.
  if (!to) return null;
  return {
    id: `${node}reach`,
    from,
    to,
    curve: true,
    trim: REACH_TRIM,
    lead,
    stroke: CLI_STROKE,
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
 * out in the last column — where it goes when the canvas draws no branch for
 * the directory it is running in. The position is read against whichever of the
 * two it is, so moving between them is a node that changed rather than two
 * nodes.
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

/**
 * Where each band goes — which, whenever it can be, is where it already was.
 *
 * Folding history away makes a band narrower, and packing it again would slide
 * every repository along the row to close the gap: the whole canvas moves out
 * from under the fold that was just made, and what was being read is somewhere
 * else. So a band that still fits where it stands keeps its place and its box,
 * gap and all. The packing is for a band that has outgrown it — history
 * expanded, a repository arrived — where there is nowhere else for the room to
 * come from.
 */
function settle(
  measured: Measured[],
  before: Map<string, Held>,
  /** Where these bands were last laid out from, when they were. */
  origin: { x: number; y: number } | undefined,
): (Measured & { x: number; y: number })[] {
  const held = measured.map(({ entry }) => {
    const node = before.get(entry.repository.id);
    return node?.type === "repository" ? node : undefined;
  });

  const settled =
    origin !== undefined &&
    measured.every(({ width }, index) => {
      const node = held[index];
      return node !== undefined && width <= Number(node.style?.width ?? 0);
    });
  if (!settled) return packRepositories(measured);

  return measured.map((member, index) => {
    const node = held[index] as RepositoryFlowNode;
    // Where it was standing, in the group's own coordinates: the folder above
    // may have grown a row since, and a band that did not move within its
    // folder should move with the folder rather than stay behind.
    return {
      ...member,
      width: Number(node.style?.width ?? member.width),
      x: node.position.x - (origin as { x: number; y: number }).x,
      y: node.position.y - (origin as { x: number; y: number }).y,
    };
  });
}

/** The band, which is the only part of a repository the packing moves. */
function repositoryNode(
  entry: PreparedRepository,
  x: number,
  y: number,
  width: number,
  before: Held | undefined,
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

/**
 * Lays the repositories out in rows, each new band going to the row that is
 * currently narrowest.
 *
 * Bands are wide and short and their widths differ by an order of magnitude — a
 * repository with three commits next to one with three hundred — so packing
 * them into columns would leave most of the canvas empty and force the initial
 * fit to zoom out past the point of being readable.
 */
function packRepositories(entries: Measured[]) {
  const placed: (Measured & { x: number; y: number })[] = [];
  if (entries.length === 0) return placed;

  const totalWidth = entries.reduce((total, entry) => total + entry.width + REPO_GAP_X, 0);
  const averageHeight =
    entries.reduce((total, entry) => total + entry.entry.style.height + REPO_GAP_Y, 0) /
    entries.length;
  const rowCount = Math.max(
    1,
    Math.min(entries.length, Math.round(Math.sqrt(totalWidth / (TARGET_ASPECT * averageHeight)))),
  );

  const rows = Array.from({ length: rowCount }, () => ({
    width: 0,
    members: [] as Measured[],
  }));

  for (const entry of entries) {
    const narrowest = rows.reduce((best, candidate) =>
      candidate.width < best.width ? candidate : best,
    );
    narrowest.members.push(entry);
    narrowest.width += entry.width + REPO_GAP_X;
  }

  let y = 0;
  for (const row of rows) {
    if (row.members.length === 0) continue;
    // Bands are laid level with one another by their trunks, not by their top
    // edges: a band is as tall as its branches make it, and two repositories
    // side by side whose histories run at different heights read as two things
    // that happened to land near each other rather than as one canvas.
    const level = Math.max(...row.members.map((member) => member.entry.trunk));
    const drop = (member: Measured) => level - member.entry.trunk;

    let x = 0;
    for (const member of row.members) {
      placed.push({ ...member, x, y: y + drop(member) });
      x += member.width + REPO_GAP_X;
    }
    y += Math.max(...row.members.map((member) => drop(member) + member.entry.style.height));
    y += REPO_GAP_Y;
  }

  return placed;
}

/** A prepared repository and the box it was laid out in. */
type Measured = { entry: PreparedRepository; width: number };
