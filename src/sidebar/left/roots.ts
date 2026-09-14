import CloudIcon from "@mui/icons-material/Cloud";
import ComputerIcon from "@mui/icons-material/Computer";
import HomeIcon from "@mui/icons-material/Home";
import StorageIcon from "@mui/icons-material/Storage";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { Root, RootKind } from "../../folder/api";
import { groupBy } from "../../lib/collections";

export const ROOT_ICONS: Record<RootKind, typeof HomeIcon> = {
  home: HomeIcon,
  "windows-drive": StorageIcon,
  "wsl-distro": TerminalIcon,
  "unix-root": StorageIcon,
  "windows-mount": ComputerIcon,
  "ssh-host": CloudIcon,
};

export interface RootGroup {
  kind: RootKind;
  roots: Root[];
}

/** Groups keep the backend's order and are not named: each kind's mark already says what it is. */
export function groupRoots(roots: Root[]): RootGroup[] {
  return [...groupBy(roots, (root) => root.kind)].map(([kind, grouped]) => ({
    kind: kind as RootKind,
    roots: grouped,
  }));
}
