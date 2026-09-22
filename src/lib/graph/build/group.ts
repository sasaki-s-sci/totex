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
  ROW_SOCKET,
  ROW_STACK_X,
} from "../folders";
import type { PreparedRepository } from "../layout";
import {
  CLI_STEP,
  type Draw,
  FOLDER_INSET,
  FOLDER_MARK,
  inBand,
  LANE_HEIGHT,
  rowReach,
} from "../model";
import { bandColumn } from "./column";
import { offerNode } from "./nodes";
import { type LaidGroup, take } from "./parts";
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
    /** Air above each band after the first, the same as between groups. */
    gap: number;
  },
  at: { x: number; y: number },
  claimed: Set<string>,
  draw: Draw,
): LaidGroup {
  const { folder, held, opened, open, showing, asks, reports, reaching, gap } = input;

  const id = folderId(folder.root);
  const shown = held.filter((entry) => isOpen(opened, entry.repository.id, held.length));

  // A repository stands as itself: no row above it, so nothing beside one either.
  const rowed = folder.kind === "folder";
  const running = rowed ? take(open, claimed, [folder.root]) : [];

  // The stack opens out either side of the row's line, so a tall one reaches above the row.
  const inset = { x: 0, y: Math.max(0, rowReach(running.length) - LANE_HEIGHT / 2) };

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

  const from = rowed ? inBand(id, ROW_SOCKET.x, ROW_SOCKET.y) : null;

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

  // Off the mark, as a branch's terminals stand off its ring.
  const beside = rowStack(
    running,
    {
      open,
      socket: inBand(id, ROW_SOCKET.x, ROW_SOCKET.y),
      group: id,
      lead: FOLDER_MARK / 2,
      at: { x: head.x + ROW_STACK_X, y: head.y + ROW_SOCKET.y },
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
        head.x + ROW_STACK_X,
        head.y + ROW_SOCKET.y - CLI_STEP / 2,
        draw,
      ),
    );
  }

  const place: Place = {
    id,
    from,
    // Inset from the mark, which the name now stands ahead of.
    x: rowed ? head.x + FOLDER_MARK_X + FOLDER_INSET : head.x,
    open,
    showing,
    asks,
    reports,
    reaching,
    gap,
    draw,
  };

  let down: Cursor = {
    cursor: rowed ? head.y + LANE_HEIGHT / 2 + rowReach(running.length) : head.y,
    above: rowed ? { line: head.y + LANE_HEIGHT / 2, marks: running.length } : null,
    floor,
    first: true,
  };
  for (const row of rows) down = placeRow(row, place, drawn, down);

  drawn.height = down.cursor - at.y;
  drawn.bottom = Math.max(drawn.bottom, down.cursor, down.floor);
  return drawn;
}
