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
  CLI_MARK,
  CLI_STEP,
  type Draw,
  FOLDER_INSET,
  FOLDER_MARK,
  inBand,
  LANE_HEIGHT,
  OFFER_STROKE,
  rowReach,
  SESSION_WIDTH,
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
    /** Group-relative left edge every terminal stack stands at; `null` leaves each where it falls. */
    axis: number | null;
  },
  at: { x: number; y: number },
  claimed: Set<string>,
  draw: Draw,
): LaidGroup {
  const { folder, held, opened, open, showing, asks, reports, reaching, gap, axis } = input;

  const id = folderId(folder.root);
  const shown = held.filter((entry) => isOpen(opened, entry.repository.id, held.length));

  // A repository stands as itself: no row above it, so nothing beside one either.
  const rowed = folder.kind === "folder";
  const running = rowed ? take(open, claimed, [folder.root]) : [];

  // The stack opens out either side of the row's line, so a tall one reaches above the row.
  // Lined up, the row moves right until its mark stands where a band's rings do.
  const inset = {
    x: rowed && axis !== null ? axis - ROW_STACK_X : 0,
    y: Math.max(0, rowReach(running.length) - LANE_HEIGHT / 2),
  };

  const head = { x: at.x + inset.x, y: at.y + inset.y };
  const stackX = at.x + (axis ?? ROW_STACK_X);

  const drawn: LaidGroup = {
    nodes: [],
    offers: [],
    bands: [],
    links: [],
    offerLinks: [],
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
      at: { x: stackX, y: head.y + ROW_SOCKET.y },
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
        stackX,
        head.y + ROW_SOCKET.y - CLI_STEP / 2,
        draw,
      ),
    );
    drawn.offerLinks.push({
      id: `offer${id}line`,
      from: inBand(id, ROW_SOCKET.x, ROW_SOCKET.y),
      to: { node: id, dx: stackX - head.x + SESSION_WIDTH / 2, dy: ROW_SOCKET.y },
      shape: "curve",
      trim: CLI_MARK / 2,
      lead: FOLDER_MARK / 2,
      stroke: OFFER_STROKE,
    });
  }

  const place: Place = {
    id,
    from,
    x: head.x + heldX(rowed),
    stack: axis === null ? null : stackX,
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

// Inset from the mark, which the name now stands ahead of.
function heldX(rowed: boolean): number {
  return rowed ? FOLDER_MARK_X + FOLDER_INSET : 0;
}

/** Group-relative left edge of the rightmost terminal stack the group would draw unaligned. */
export function stackAxis(
  folder: Folder,
  held: readonly PreparedRepository[],
  opened: ReadonlyMap<string, boolean>,
): number {
  const x = heldX(folder.kind === "folder");
  let reach = folder.kind === "folder" ? ROW_STACK_X : 0;
  for (const entry of held) {
    const shown = isOpen(opened, entry.repository.id, held.length);
    reach = Math.max(reach, x + (shown ? entry.stack : ROW_STACK_X));
  }
  return reach;
}
