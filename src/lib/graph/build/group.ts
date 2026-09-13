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

export function folderGroup(
  input: {
    folder: Folder;

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

  // Only what no repository in the folder answers for: a folder opened on a repository is one directory, two rows.
  const inside = new Set<string>();
  for (const entry of held) {
    inside.add(entry.repository.path);
    for (const worktree of entry.repository.worktrees) inside.add(worktree.path);
  }
  const running = inside.has(folder.root) ? [] : take(open, claimed, [folder.root]);

  // A folder holding nothing sets its terminals round its row; with rows below, a ring would run through them.
  const ring = held.length === 0 ? ringAround(running.length) : null;

  const inset = {
    x: ring ? Math.max(0, -ring.left) : 0,
    y: ring ? Math.max(0, -ring.top) : 0,
  };

  const head = { x: at.x + inset.x, y: at.y + inset.y };

  const drawn: LaidGroup = {
    nodes: [],
    bands: [],
    links: [],
    holds: [],
    members: [],
    inset,
    right: head.x + FOLDER_ROW_WIDTH,
    bottom: head.y + LANE_HEIGHT,
    height: LANE_HEIGHT,
  };

  drawn.nodes.push(folderRow(folder.root, folder.name, shown.length === held.length, head, draw));

  const from = inBand(id, FOLDER_MARK_X + FOLDER_MARK / 2, LANE_HEIGHT / 2);

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

  let floor = Number.NEGATIVE_INFINITY;

  const beside = ring
    ? rowRing(running, { open, node: id, ring, at: head, showing, asks, reports, floor }, draw)
    : rowStack(
        running,
        {
          open,

          socket: inBand(id, FOLDER_ROW_WIDTH, LANE_HEIGHT / 2),

          group: id,
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
