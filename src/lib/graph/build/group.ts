/**
 * One folder laid out: its row, the repositories under it, and everything
 * running in either.
 */

import type { Folder } from "../../../hooks/useWorkspace";
import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import type { Session } from "../../session";
import {
  FOLDER_MARK_X,
  FOLDER_ROW_WIDTH,
  folderId,
  folderRow,
  isOpen,
  ringAround,
} from "../folders";
import type { PreparedRepository } from "../layout";
import {
  CHIP_STEP,
  type Draw,
  FOLDER_INSET,
  FOLDER_MARK,
  inBand,
  LANE_HEIGHT,
  rowReach,
  SESSION_WIDTH,
} from "../model";
import { bandColumn } from "./column";
import { type LaidGroup, REACH_TRIM, take } from "./parts";
import { rowRing } from "./ring";
import { type Cursor, type Place, placeRow, type Row } from "./rows";
import { merge, rowStack } from "./stack";

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
export function folderGroup(
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

  const id = folderId(folder.root);
  const shown = held.filter((entry) => isOpen(opened, entry.repository.id, held.length));

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

  /**
   * The ring, for a folder that holds no repository at all.
   *
   * Such a folder is a row and nothing else: there is no column under it and no
   * band beside it, and until something is opened in it the canvas has drawn a
   * name and stopped. So what is running in it is set round the row from three
   * o'clock rather than stacked off the end of it — the room is there, and a
   * folder somebody works in directly reads as the thing its terminals are on
   * rather than as a heading with a list beside it.
   *
   * A folder that does hold repositories is laid out exactly as it was: the
   * column is what says which repository is which, and a ring drawn round the
   * head of it would be drawn straight through it.
   */
  const ring = held.length === 0 ? ringAround(running.length) : null;
  /** How far the ring reaches back past the row, which is the room for it. */
  const inset = {
    x: ring ? Math.max(0, -ring.left) : 0,
    y: ring ? Math.max(0, -ring.top) : 0,
  };
  /** Where the row itself stands, which everything in the group is placed by. */
  const head = { x: at.x + inset.x, y: at.y + inset.y };

  const drawn: LaidGroup = {
    nodes: [],
    bands: [],
    links: [],
    members: [],
    inset,
    right: head.x + FOLDER_ROW_WIDTH,
    bottom: head.y + LANE_HEIGHT,
    height: LANE_HEIGHT,
  };

  drawn.nodes.push(folderRow(folder.root, folder.name, shown.length === held.length, head, draw));

  // Where every line the folder draws leaves from: its own mark, which is the
  // one thing on the row that is the folder itself.
  const from = inBand(id, FOLDER_MARK_X + FOLDER_MARK / 2, LANE_HEIGHT / 2);

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

  const beside = ring
    ? rowRing(running, { open, node: id, ring, at: head, showing, asks, reports, floor }, draw)
    : rowStack(
        running,
        {
          open,
          // Past the last of the row's buttons rather than on any of them: the
          // row is the place, and there is no mark on it that is the directory.
          socket: inBand(id, FOLDER_ROW_WIDTH, LANE_HEIGHT / 2),
          lead: REACH_TRIM,
          at: {
            x: head.x + FOLDER_ROW_WIDTH + CHIP_STEP - SESSION_WIDTH / 2,
            y: head.y + LANE_HEIGHT / 2,
          },
          showing,
          asks,
          reports,
          floor,
        },
        draw,
      );
  merge(beside, drawn);
  floor = beside.floor;

  const place: Place = {
    id,
    from,
    x: head.x + FOLDER_INSET,
    open,
    showing,
    asks,
    reports,
    reaching,
    draw,
  };
  /** How far down the column has got, which the next row is placed against. */
  let down: Cursor = {
    cursor: ring ? head.y + ring.bottom : head.y + LANE_HEIGHT / 2 + rowReach(running.length),
    above: { line: head.y + LANE_HEIGHT / 2, marks: running.length },
    floor,
    first: true,
  };
  for (const row of rows) down = placeRow(row, place, drawn, down);

  drawn.height = down.cursor - at.y;
  drawn.bottom = Math.max(drawn.bottom, down.cursor, down.floor);
  return drawn;
}
