import ComputerIcon from "@mui/icons-material/Computer";
import HomeIcon from "@mui/icons-material/Home";
import StorageIcon from "@mui/icons-material/Storage";
import TerminalIcon from "@mui/icons-material/Terminal";

import { groupBy } from "../lib/collections";
import type { Root, RootKind } from "./api";

/** One icon per kind of place a pane can be started at. */
export const ROOT_ICONS: Record<RootKind, typeof HomeIcon> = {
  home: HomeIcon,
  "windows-drive": StorageIcon,
  "wsl-distro": TerminalIcon,
  "unix-root": StorageIcon,
  "windows-mount": ComputerIcon,
};

export interface RootGroup {
  kind: RootKind;
  roots: Root[];
}

/**
 * Groups roots by origin while keeping the order the backend chose.
 *
 * The groups are not named. Each kind has its own mark and they come in a
 * settled order, so what a group is, is the mark every row in it carries — a
 * heading over them would be that same thing said once more in words.
 */
export function groupRoots(roots: Root[]): RootGroup[] {
  return [...groupBy(roots, (root) => root.kind)].map(([kind, grouped]) => ({
    kind: kind as RootKind,
    roots: grouped,
  }));
}
