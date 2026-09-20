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
  CLI_STEP,
  type Draw,
  FOLDER_INSET,
  FOLDER_MARK,
  inBand,
  LANE_HEIGHT,
  rowReach,
  SESSION_WIDTH,
} from "../model";
import { bandColumn } from "./column";
import { offerNode } from "./nodes";
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

  // A repository stands as itself: no row above it, so nothing beside one either.
  const rowed = folder.kind === "folder";
  const running = rowed ? take(open, claimed, [folder.root]) : [];

  // A folder holding nothing sets its terminals round its row; with rows below, a ring would run through them.
  const ring = rowed && held.length === 0 ? ringAround(running.length) : null;

  const inset = {
    x: ring ? Math.max(0, -ring.left) : 0,
    y: ring ? Math.max(0, -ring.top) : 0,
  };

  const head = { x: at.x + inset.x, y: at.y + inset.y };

  const drawn: LaidGroup = {
    nodes: [],
    offers: [],
    bands: [],
    links: [],
    holds: [],
    members: [],
    inset,
    right: rowed ? head.x + FOLDER_ROW_WIDTH : head.x,
    bottom: rowed ? head.y + LANE_HEIGHT : head.y,
    height: rowed ? LANE_HEIGHT : 0,
  };

  if (rowed) {
    drawn.nodes.push(
      folderRow(folder.root, folder.name, folder.kind, shown.length === held.length, head, draw),
    );
  }

  const from = rowed ? inBand(id, FOLDER_MARK_X + FOLDER_MARK / 2, LANE_HEIGHT / 2) : null;

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

  // An empty row offers its first terminal where a stack of one would stand.
  if (rowed && !open.has(folder.root)) {
    drawn.offers.push(
      offerNode(
        `offer${id}`,
        { kind: "open", repository: null, branch: folder.name, cwd: folder.root },
        null,
        head.x + FOLDER_ROW_WIDTH + CHIP_STEP - SESSION_WIDTH / 2,
        head.y + LANE_HEIGHT / 2 - CLI_STEP / 2,
        draw,
      ),
    );
  }

  const place: Place = {
    id,
    from,
    x: rowed ? head.x + FOLDER_INSET : head.x,
    open,
    showing,
    asks,
    reports,
    reaching,
    draw,
  };

  let down: Cursor = {
    cursor: !rowed
      ? head.y
      : ring
        ? head.y + ring.bottom
        : head.y + LANE_HEIGHT / 2 + rowReach(running.length),
    above: rowed ? { line: head.y + LANE_HEIGHT / 2, marks: running.length } : null,
    floor,
    first: true,
  };
  for (const row of rows) down = placeRow(row, place, drawn, down);

  drawn.height = down.cursor - at.y;
  drawn.bottom = Math.max(drawn.bottom, down.cursor, down.floor);
  return drawn;
}
