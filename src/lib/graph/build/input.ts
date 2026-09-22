import type { Folder } from "../../../hooks/useWorkspace";
import type { Workspace } from "../../../types/git";
import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import type { Session } from "../../session";

export type GraphInput = {
  workspace: Workspace;

  folders: readonly Folder[];

  /** How much history each repository shows, by id. */
  visible: ReadonlyMap<string, number>;

  /** Repositories opened into bands. Absent is not closed: see `isOpen`. */
  opened: ReadonlyMap<string, boolean>;

  /** Junction knots pressed shut, by node id. */
  closed: ReadonlySet<string>;

  sessions: readonly Session[];

  showing: string | null;

  asks: ReadonlyMap<string, Ask>;

  reports: ReadonlyMap<string, Report>;

  /** The repository a pull is under way in; its `visible` depth is a proposal. */
  reaching: string | null;

  /** How far each folder was dragged from its laid-out slot, by root. */
  places: ReadonlyMap<string, { x: number; y: number }>;

  /** Air between one repository or folder and the next, in layout units; `REPO_GAP_Y` unless said. */
  gap?: number;
};
